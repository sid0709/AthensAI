// Thin client for ai-bff — all LLM traffic goes through the gateway.

import { randomUUID } from 'node:crypto';
import {
  costFromUsage,
  findPricing,
  formatUsd as formatCostUsd,
} from '@nextoffer/shared/pricing';
import { createLogger } from '@nextoffer/shared/terminal-log';
import { DEEPSEEK_MODELS, isDeepSeekModel, listOpenAiModels } from '@nextoffer/shared/models';
import {
  LLM_PRIORITY,
  llmAdmissionPool,
  llmPriorityFromFeature,
} from '../../utils/concurrency.js';
import { getServiceAuthHeaders } from '../googleServiceAuth.js';
import { incrementCounter, observeHistogram } from '../monitoring/metrics.js';
import { assertBackgroundTaskActive } from '../backgroundTasks/taskContext.js';

const log = createLogger('athens');

const AI_BASE = (process.env.AI_BFF_URL || 'http://127.0.0.1:3920').replace(/\/$/, '');

export const PROVIDERS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyField: 'openaiApiKey',
    models: null,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    keyField: 'deepseekApiKey',
    models: DEEPSEEK_MODELS,
  },
};

export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS.openai;
}

export function isModelCompatibleWithProvider(provider, model) {
  const modelId = String(model || '').trim();
  if (!modelId || (provider !== 'openai' && provider !== 'deepseek')) return false;
  return provider === 'deepseek' ? isDeepSeekModel(modelId) : !isDeepSeekModel(modelId);
}

/**
 * Single source of truth for "which model do we call?" — resolves only the
 * profile's saved default (defaultProvider + defaultModel), set via
 * Settings → Profile. A missing or inconsistent default stays unresolved so a
 * feature cannot silently fall through to ai-bff's process-wide GPT default.
 *
 * @returns {{ provider: 'openai'|'deepseek', apiKey: string, model: string, configured: boolean, error: string|null }}
 */
export function resolveDefaultModel(profile) {
  const p = profile || {};
  const savedProvider = p.defaultProvider === 'openai' || p.defaultProvider === 'deepseek'
    ? p.defaultProvider
    : null;
  const provider = savedProvider || (p.deepseekApiKey ? 'deepseek' : p.openaiApiKey ? 'openai' : 'deepseek');
  const apiKey = String((provider === 'openai' ? p.openaiApiKey : p.deepseekApiKey) || '').trim();
  const savedModel = String(p.defaultModel || '').trim();
  let error = null;
  if (!savedProvider || !savedModel) {
    error = 'Set a default AI provider and model in Settings → Profile.';
  } else if (!isModelCompatibleWithProvider(provider, savedModel)) {
    error = `The saved ${provider} default model "${savedModel}" belongs to a different provider.`;
  }
  return {
    provider,
    apiKey,
    model: error ? '' : savedModel,
    configured: !error,
    error,
  };
}

export function getPricing(model) {
  const row = findPricing(model);
  if (!row) return null;
  return { input: row.input, cached: row.cachedInput ?? row.input, output: row.output };
}

export function summarizeUsage(usage, model) {
  const u = costFromUsage(model, usage);
  const pricing = findPricing(model);
  const totalInput = u.inputTokens + u.cachedTokens;
  const costNoCache = pricing
    ? (totalInput / 1_000_000) * pricing.input + (u.outputTokens / 1_000_000) * pricing.output
    : null;
  const savings = costNoCache != null ? Math.max(0, costNoCache - u.costUsd) : null;
  return {
    model,
    inputTokens: u.inputTokens,
    cachedTokens: u.cachedTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
    cost: u.costUsd,
    savings,
    priced: u.priced,
  };
}

export const EMPTY_USAGE = () => ({
  model: null,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
  savings: 0,
});

export function addUsage(a, b) {
  if (!b) return a;
  return {
    model: b.model ?? a.model,
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: a.cost == null || b.cost == null ? null : a.cost + b.cost,
    savings: a.savings == null || b.savings == null ? null : a.savings + b.savings,
  };
}

export { formatCostUsd };

export function formatUsageSummary(usage) {
  if (!usage) return '';
  const cost = formatCostUsd(usage.cost);
  const parts = [
    `${usage.inputTokens?.toLocaleString() ?? 0} in`,
    `${usage.outputTokens?.toLocaleString() ?? 0} out`,
  ];
  if (usage.cachedTokens > 0) parts.push(`${usage.cachedTokens.toLocaleString()} cached`);
  if (cost) parts.push(cost);
  return parts.join(' · ');
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason || Object.assign(new Error('LLM request cancelled'), { name: 'AbortError' }));
    return;
  }
  const timer = setTimeout(done, ms);
  const aborted = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    reject(signal.reason || Object.assign(new Error('LLM request cancelled'), { name: 'AbortError' }));
  };
  function done() {
    signal?.removeEventListener('abort', aborted);
    resolve();
  }
  signal?.addEventListener('abort', aborted, { once: true });
});

/** Default chat timeout — generous so long completions are never cut off mid-stream. */
const DEFAULT_CHAT_TIMEOUT_MS = Number.parseInt(String(process.env.LLM_TIMEOUT_MS || ''), 10) || 600_000;

export function isRequestTimeoutError(error) {
  return error?.name === 'TimeoutError'
    || error?.cause?.name === 'TimeoutError'
    || error?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT'
    || error?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
}

/**
 * Fail-fast only when ai-bff is genuinely DOWN (connection errors).
 * Does NOT limit normal AI usage — open circuit recovers automatically.
 */
const breaker = {
  failures: 0,
  openUntil: 0,
  threshold: Number.parseInt(String(process.env.AI_BFF_BREAKER_THRESHOLD || ''), 10) || 8,
  cooldownMs: Number.parseInt(String(process.env.AI_BFF_BREAKER_COOLDOWN_MS || ''), 10) || 15_000,
};

function breakerAllow() {
  return Date.now() >= breaker.openUntil;
}

function breakerSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

function breakerFailure() {
  breaker.failures += 1;
  if (breaker.failures >= breaker.threshold) {
    breaker.openUntil = Date.now() + breaker.cooldownMs;
    console.warn(
      `[llm] ai-bff circuit open for ${breaker.cooldownMs}ms after ${breaker.failures} consecutive connection failures`,
    );
  }
}

function combinedSignal(externalSignal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeout;
  // Node 20+: abort as soon as either the caller aborts or the timeout fires.
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([externalSignal, timeout]);
  return externalSignal.aborted ? externalSignal : timeout;
}

async function fetchRetry(url, init, {
	timeoutMs = DEFAULT_CHAT_TIMEOUT_MS,
	retries = 4,
	baseDelayMs = 1000,
	signal,
	beforeAttempt,
} = {}) {
  if (!breakerAllow()) {
    const err = new Error('ai-bff circuit open — gateway unreachable, retry shortly');
    err.status = 503;
    throw err;
  }

  for (let attempt = 0; ; attempt += 1) {
		await beforeAttempt?.();
    let response;
    try {
      response = await fetch(url, { ...init, signal: combinedSignal(signal, timeoutMs) });
      breakerSuccess();
    } catch (err) {
      // A caller-requested abort is terminal — never retry through a Stop.
      if (signal?.aborted) throw err;
      // Retrying a full request timeout used to turn one 10-minute ceiling into
      // nearly 50 minutes, which looked like an unlimited generation loop.
      if (isRequestTimeoutError(err)) {
        const timeoutError = new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
        timeoutError.name = 'TimeoutError';
        timeoutError.status = 504;
        timeoutError.cause = err;
        throw timeoutError;
      }
      breakerFailure();
      if (attempt >= retries) throw err;
			incrementCounter('athens_llm_retries_total', { reason: 'network' });
      console.warn(`[llm] fetch error (attempt ${attempt + 1}/${retries + 1}) ${url} — ${err.message}, retrying...`);
      await sleep(baseDelayMs * 2 ** attempt, signal);
      continue;
    }
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt >= retries) return response;
		incrementCounter('athens_llm_retries_total', { reason: `http_${response.status}` });
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** attempt;
    console.warn(`[llm] status ${response.status} (attempt ${attempt + 1}/${retries + 1}) ${url} — retrying in ${Math.min(delay, 15000)}ms`);
    await sleep(Math.min(delay, 15000), signal);
  }
}

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const isReasoningModel = (model) => /^(gpt-5|o1|o3|o4)/i.test(String(model));

export async function chatCompletion({
  provider,
  apiKey,
  model,
  messages,
  jsonMode = false,
  cacheKey,
  reasoningEffort,
  timeoutMs = DEFAULT_CHAT_TIMEOUT_MS,
  retries = 4,
  runId,
  feature = 'resume-analysis',
  applierName,
  jobId,
  requestId,
  signal,
}) {
  const p = getProvider(provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${p.label}. Add it under Settings → Profile.`);
  }
  if (!String(model || '').trim()) {
    throw new Error('No default AI model is configured. Set one under Settings → Profile.');
  }
  if (!isModelCompatibleWithProvider(p.id, model)) {
    throw new Error(`Model "${model}" is not valid for the ${p.label} profile default.`);
  }

  const body = {
    model,
    messages,
    apiKeys: p.id === 'deepseek' ? { deepseek: apiKey } : { openai: apiKey },
    workloadClass: process.env.BACKGROUND_TASK_WORKER === 'true' ? 'background' : 'interactive',
  };
  if (jsonMode && (p.id === 'openai' || p.id === 'deepseek')) {
    body.response_format = { type: 'json_object' };
    body.jsonMode = true;
  }
  if (cacheKey) body.prompt_cache_key = cacheKey;
  if (p.id === 'openai' && isReasoningModel(model) && reasoningEffort && reasoningEffort !== 'default') {
    body.reasoning_effort = reasoningEffort;
  }
  const promptChars = messages.reduce((sum, m) => sum + String(m?.content || '').length, 0);
  const startedAt = Date.now();
  const reqId = requestId || randomUUID();
  const priorityKey = llmPriorityFromFeature(feature);
  const priority = LLM_PRIORITY[priorityKey] ?? LLM_PRIORITY.other;
  if (process.env.LLM_LOG !== 'off') {
    log.llm({
      msg: 'chat started',
      requestId: reqId,
      feature,
      provider: p.id,
      requestedModel: model,
      runId,
      applierName,
      messageCount: messages.length,
      promptChars,
      jsonMode: jsonMode || undefined,
      priority: priorityKey,
    });
  }

  return llmAdmissionPool.run(
    priority,
    async () => {
      if (signal?.aborted) {
        throw signal.reason || Object.assign(new Error('LLM request cancelled'), { name: 'AbortError' });
      }
      const admittedAt = Date.now();
      const queueWaitMs = admittedAt - startedAt;
      observeHistogram('athens_llm_admission_wait_seconds', {
        feature,
        priority: priorityKey,
      }, queueWaitMs / 1_000);
      if (queueWaitMs > 50 && process.env.LLM_LOG !== 'off') {
        log.llm({
          msg: 'chat admitted after queue wait',
          requestId: reqId,
          feature,
          priority: priorityKey,
          queueWaitMs,
          llmPending: llmAdmissionPool.pending,
          llmActive: llmAdmissionPool.active,
        });
      }

      const response = await fetchRetry(
        `${AI_BASE}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getServiceAuthHeaders(AI_BASE)),
            'x-provider-api-key': apiKey,
            'x-request-id': reqId,
            ...(runId ? { 'x-run-id': runId } : {}),
            ...(applierName ? { 'x-applier-name': applierName } : {}),
            ...(jobId ? { 'x-job-id': jobId } : {}),
            'x-feature': feature,
          },
          body: JSON.stringify(body),
        },
		{ timeoutMs, retries, signal, beforeAttempt: () => assertBackgroundTaskActive(signal) },
      );

      const data = await response.json().catch(() => ({}));
      const elapsedMs = Date.now() - startedAt;
      observeHistogram('athens_llm_dependency_duration_seconds', {
        feature,
        provider: p.id,
      }, Math.max(0, elapsedMs - queueWaitMs) / 1_000);
      if (!response.ok) {
        const providerMessage = typeof data?.error === 'string' ? data.error : data?.error?.message;
        const err = new Error(providerMessage || `${p.label} request failed (${response.status})`);
        err.status = response.status;
        err.provider = p.id;
        log.error('llm', 'chat failed', {
          requestId: reqId,
          feature,
          provider: p.id,
          requestedModel: model,
          durationMs: elapsedMs,
          queueWaitMs,
          httpStatus: response.status,
          error: err.message,
        });
        throw err;
      }
      const content = data?.choices?.[0]?.message?.content;
      if (content == null) {
        log.error('llm', 'empty response', {
          requestId: reqId,
          feature,
          provider: p.id,
          requestedModel: model,
          durationMs: elapsedMs,
        });
        throw new Error(`${p.label} returned an empty response.`);
      }
      const billedModel = data?.model ?? model;
      const usage = summarizeUsage(data?.usage, billedModel);
      const finishReason = data?.choices?.[0]?.finish_reason ?? null;
      if (jsonMode && finishReason === 'length') {
        const err = new Error(
          `${p.label} reached its provider-native output limit before returning complete JSON.`,
        );
        err.status = 502;
        err.provider = p.id;
        err.code = 'LLM_JSON_OUTPUT_LIMIT';
        log.error('llm', 'json output truncated', {
          requestId: reqId,
          feature,
          provider: p.id,
          requestedModel: model,
          outputTokens: usage.outputTokens,
        });
        throw err;
      }
      if (process.env.LLM_LOG !== 'off') {
        log.llm({
          msg: 'chat completed',
          requestId: reqId,
          feature,
          provider: p.id,
          requestedModel: model,
          billedModel,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.cost,
          durationMs: elapsedMs,
          queueWaitMs,
          runId,
          applierName,
          modelMismatch: model !== billedModel,
        });
      }
      return {
        content,
        usage,
        requestId: data?.requestId || reqId,
        provider: data?.provider || p.id,
        requestedModel: data?.requestedModel || model,
        billedModel,
        finishReason,
      };
    },
    {
		signal,
      onQueued: (pending) => {
        if (process.env.LLM_LOG !== 'off') {
          log.llm({
            msg: 'chat queued for LLM admission',
            requestId: reqId,
            feature,
            priority: priorityKey,
            pending,
          });
        }
      },
    },
  );
}

/**
 * Streaming chat completion. Yields { type:'delta', text } then { type:'done', ... }.
 * No jsonMode by default — favors time-to-first-token for interactive UX.
 */
export async function* chatCompletionStream({
  provider,
  apiKey,
  model,
  messages,
  jsonMode = false,
  cacheKey,
  reasoningEffort,
  timeoutMs = DEFAULT_CHAT_TIMEOUT_MS,
  runId,
  feature = 'resume-analysis',
  applierName,
  jobId,
  requestId,
  signal,
}) {
  const p = getProvider(provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${p.label}. Add it under Settings → Profile.`);
  }
  if (!String(model || '').trim()) {
    throw new Error('No default AI model is configured. Set one under Settings → Profile.');
  }
  if (!isModelCompatibleWithProvider(p.id, model)) {
    throw new Error(`Model "${model}" is not valid for the ${p.label} profile default.`);
  }

  const body = {
    model,
    messages,
    stream: true,
    apiKeys: p.id === 'deepseek' ? { deepseek: apiKey } : { openai: apiKey },
    workloadClass: process.env.BACKGROUND_TASK_WORKER === 'true' ? 'background' : 'interactive',
  };
  if (jsonMode && (p.id === 'openai' || p.id === 'deepseek')) {
    body.response_format = { type: 'json_object' };
    body.jsonMode = true;
  }
  if (cacheKey) body.prompt_cache_key = cacheKey;
  if (p.id === 'openai' && isReasoningModel(model) && reasoningEffort && reasoningEffort !== 'default') {
    body.reasoning_effort = reasoningEffort;
  }

  const promptChars = messages.reduce((sum, m) => sum + String(m?.content || '').length, 0);
  const startedAt = Date.now();
  const reqId = requestId || randomUUID();

  if (process.env.LLM_LOG !== 'off') {
    log.llm({
      msg: 'chat stream started',
      requestId: reqId,
      feature,
      provider: p.id,
      requestedModel: model,
      promptChars,
    });
  }

  if (signal?.aborted) {
    throw signal.reason || Object.assign(new Error('LLM request cancelled'), { name: 'AbortError' });
  }

  const response = await fetchRetry(
    `${AI_BASE}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(await getServiceAuthHeaders(AI_BASE)),
        'x-provider-api-key': apiKey,
        'x-request-id': reqId,
        ...(runId ? { 'x-run-id': runId } : {}),
        ...(applierName ? { 'x-applier-name': applierName } : {}),
        ...(jobId ? { 'x-job-id': jobId } : {}),
        'x-feature': feature,
      },
      body: JSON.stringify(body),
    },
    { timeoutMs, retries: 2, signal, beforeAttempt: () => assertBackgroundTaskActive(signal) },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const providerMessage = typeof data?.error === 'string' ? data.error : data?.error?.message;
    const err = new Error(providerMessage || `${p.label} stream failed (${response.status})`);
    err.status = response.status;
    throw err;
  }

  if (!response.body) {
    throw new Error(`${p.label} returned an empty stream body.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let billedModel = model;
  let usageRaw = null;

  while (true) {
    if (signal?.aborted) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw signal.reason || Object.assign(new Error('LLM request cancelled'), { name: 'AbortError' });
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed?.model) billedModel = parsed.model;
      if (parsed?.usage) usageRaw = parsed.usage;
      const delta = parsed?.choices?.[0]?.delta?.content
        ?? parsed?.choices?.[0]?.text
        ?? '';
      if (delta) yield { type: 'delta', text: String(delta) };
    }
  }

  const usage = summarizeUsage(usageRaw, billedModel || model);
  const elapsedMs = Date.now() - startedAt;
  if (process.env.LLM_LOG !== 'off') {
    log.llm({
      msg: 'chat stream completed',
      requestId: reqId,
      feature,
      provider: p.id,
      requestedModel: model,
      billedModel,
      durationMs: elapsedMs,
      outputTokens: usage.outputTokens,
    });
  }
  yield {
    type: 'done',
    usage,
    requestId: reqId,
    provider: p.id,
    requestedModel: model,
    billedModel,
  };
}

const modelCache = new Map();
const MODEL_TTL_MS = 5 * 60 * 1000;

export async function verifyKey({ provider, apiKey, model: requestedModel }) {
  const p = getProvider(provider);
  if (!apiKey) return { ok: false, status: 400, message: `No ${p.label} API key provided.` };
  try {
    // OpenAI's model catalog validates the key and the selected model without
    // spending output tokens. A one-token chat probe is not valid for GPT
    // reasoning models because reasoning itself can consume that allowance.
    if (p.id === 'openai') {
      const catalog = await listOpenAiModels(apiKey);
      const requested = String(requestedModel || '').trim();
      if (requested && !catalog.some((entry) => entry.id === requested)) {
        return {
          ok: false,
          status: 400,
          message: `${requested} is not available to this OpenAI API key.`,
        };
      }
      return { ok: true, status: 200, message: `${p.label} key is valid.` };
    }

    const model = isModelCompatibleWithProvider(p.id, requestedModel)
      ? String(requestedModel).trim()
      : Array.isArray(p.models) ? p.models[0] : 'gpt-4o-mini';
    const response = await fetchRetry(
      `${AI_BASE}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getServiceAuthHeaders(AI_BASE)),
          'x-provider-api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          apiKeys: p.id === 'deepseek' ? { deepseek: apiKey } : { openai: apiKey },
        }),
      },
      { timeoutMs: 15000, retries: 1 },
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, status: 200, message: `${p.label} key is valid.` };
    return {
      ok: false,
      status: response.status,
      message: data?.error?.message || data?.error || `${p.label} rejected the key.`,
    };
  } catch (err) {
    return { ok: false, status: 0, message: `Could not validate ${p.label} key: ${err.message}` };
  }
}

export async function listModels({ provider, apiKey, force = false }) {
  const p = getProvider(provider);
  if (Array.isArray(p.models)) return p.models;
  if (!apiKey) throw new Error(`No API key configured for ${p.label}.`);

  // Cache per provider + key fingerprint so profile keys (DB) never share a
  // stale empty list from a missing ai-bff .env key.
  const cacheKey = `${p.id}:${String(apiKey).slice(-12)}`;
  const cached = modelCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.models;

  // OpenAI: list with the profile/DB key directly — do not use ai-bff /v1/models,
  // which only exposes providers configured in ai-bff .env.
  if (p.id === 'openai') {
    const catalog = await listOpenAiModels(apiKey);
    const models = catalog.map((m) => String(m.id)).filter(Boolean).sort();
    modelCache.set(cacheKey, { at: Date.now(), models });
    return models;
  }

  const response = await fetchRetry(
    `${AI_BASE}/v1/models`,
    {
      headers: {
        ...(await getServiceAuthHeaders(AI_BASE)),
        'x-provider-api-key': apiKey,
      },
    },
    { timeoutMs: 20000, retries: 2 },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || data?.error || `${p.label} model list failed`);
    err.status = response.status;
    throw err;
  }
  const catalog = Array.isArray(data?.models)
    ? data.models
    : Array.isArray(data?.data)
      ? data.data
      : [];
  const models = catalog
    .map((m) => String(m?.id || ''))
    .filter(Boolean)
    .filter((id) => !/(embedding|whisper|tts|audio|image|moderation|realtime|search|transcribe)/i.test(id))
    .sort();
  modelCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

export { isDeepSeekModel, listOpenAiModels };

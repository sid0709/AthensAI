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

/**
 * Single source of truth for "which model do we call?" — resolves the profile's
 * saved default (defaultProvider + defaultModel), set via Settings → Profile.
 * Falls back to whichever provider has a key, then that provider's default
 * model, so it works before a default is explicitly chosen. Every feature
 * (resume generation, agent work, job skill extraction, resume analysis, mail
 * verification) goes through this — no hardcoded provider/model anywhere else.
 *
 * @returns {{ provider: 'openai'|'deepseek', apiKey: string, model: string }}
 */
export function resolveDefaultModel(profile) {
  const p = profile || {};
  let provider = p.defaultProvider;
  if (provider !== 'openai' && provider !== 'deepseek') {
    provider = p.deepseekApiKey ? 'deepseek' : p.openaiApiKey ? 'openai' : 'deepseek';
  }
  const apiKey = String((provider === 'openai' ? p.openaiApiKey : p.deepseekApiKey) || '').trim();
  const fallbackModel = provider === 'openai' ? 'gpt-4o-mini' : (DEEPSEEK_MODELS[0] || 'deepseek-v4-flash');
  const model = String(p.defaultModel || '').trim() || fallbackModel;
  return { provider, apiKey, model };
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
export const DEFAULT_DEEPSEEK_CHAT_MAX_TOKENS = Math.max(
  1_024,
  Number.parseInt(String(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS || ''), 10) || 8_192,
);

/** DeepSeek otherwise runs to its provider ceiling when a caller omits maxTokens. */
export function resolveChatMaxTokens(provider, requestedMaxTokens) {
  if (Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0) {
    return Math.floor(requestedMaxTokens);
  }
  return provider === 'deepseek' ? DEFAULT_DEEPSEEK_CHAT_MAX_TOKENS : undefined;
}

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
  maxTokens,
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

  const effectiveMaxTokens = resolveChatMaxTokens(p.id, maxTokens);
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
  if (Number.isFinite(effectiveMaxTokens) && effectiveMaxTokens > 0) {
    if (p.id === 'openai' && isReasoningModel(model)) body.max_completion_tokens = effectiveMaxTokens;
    else body.max_tokens = effectiveMaxTokens;
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
      maxTokens: effectiveMaxTokens,
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
          `${p.label} reached the ${effectiveMaxTokens ?? 'configured'}-token output limit before returning complete JSON.`,
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
          maxTokens: effectiveMaxTokens,
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

const modelCache = new Map();
const MODEL_TTL_MS = 5 * 60 * 1000;

export async function verifyKey({ provider, apiKey }) {
  const p = getProvider(provider);
  if (!apiKey) return { ok: false, status: 400, message: `No ${p.label} API key provided.` };
  try {
    const model = Array.isArray(p.models) ? p.models[0] : 'gpt-4o-mini';
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
          max_tokens: 1,
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
    return { ok: false, status: 0, message: `Could not reach AI gateway: ${err.message}` };
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

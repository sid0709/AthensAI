import { DocumentId } from "@nextoffer/shared/document-id";
import { randomUUID } from "node:crypto";
import {
  jobsCollection,
  accountInfoCollection,
  resumeGeneratorConfigCollection,
} from "../db/dataStore.js";
import { JobSource } from "../config/jobSources.js";
import { DEEPSEEK_MODELS, listOpenAiModels } from "@nextoffer/shared/models";
import { createAsyncHandler } from "../utils/http.js";
import { findAccountByApplierName } from "../services/mail/credentials.js";
import { resolveDefaultModel } from "../services/llm/llmService.js";
import { decryptProfileApiKeys } from "../services/autoBidProfileSecrets.js";
import { getServiceAuthHeaders } from "../services/googleServiceAuth.js";
import { listJobsV2 } from "../services/jobListReadModelService.js";
import { createJobRecord } from "./jobController.js";

const AI_BFF_URL = (process.env.AI_BFF_URL || "http://127.0.0.1:3920").replace(/\/$/, "");

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function canonicalJobUrl(raw) {
  const parsed = new URL(String(raw || "").trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Job URL must use http or https');
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$|mc_)/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function sanitizedJobDescription(raw) {
  return String(raw || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80_000);
}

async function accountForRequest(req) {
  if (!accountInfoCollection) return null;
  const profileId = String(req.query?.profileId || req.body?.profileId || '').trim();
  if (profileId && DocumentId.isValid(profileId)) {
    const byId = await accountInfoCollection.findOne({ _id: new DocumentId(profileId) });
    if (byId) return byId;
  }
  const applierName = String(req.query?.applierName || req.body?.applierName || '').trim();
  return applierName ? findAccountByApplierName(applierName) : null;
}

async function resolveOpenAiKey(profileId) {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (!profileId || !accountInfoCollection) return envKey || null;
  if (!DocumentId.isValid(profileId)) return envKey || null;
  const doc = await accountInfoCollection.findOne(
    { _id: new DocumentId(profileId) },
    { projection: { "autoBidProfile.openaiApiKey": 1 } },
  );
  return String((await decryptProfileApiKeys(doc?.autoBidProfile || {}))?.openaiApiKey || '').trim() || envKey || null;
}

export const getAgentHealth = createAsyncHandler(async (_req, res) => {
  res.json({
    ok: true,
    database: "firestore",
  });
});

export const getAgentModels = createAsyncHandler(async (req, res) => {
  const profileId = String(req.query.profileId || "");
  const openaiKey = await resolveOpenAiKey(profileId);
  let models = [];
  if (openaiKey) {
    try {
      models = await listOpenAiModels(openaiKey);
    } catch (err) {
      console.warn("OpenAI model list failed:", err?.message || err);
    }
  }
  models = [...models, ...DEEPSEEK_MODELS.map((id) => ({ id }))];
  res.json({ models });
});

export const getAgentJobSources = createAsyncHandler(async (req, res) => {
  const account = await accountForRequest(req);
  if (!account?.name) return res.status(404).json({ error: 'Profile not found' });
  const result = await withTimeout(listJobsV2({
    applierName: account.name,
    applied: false,
    limit: 1,
    facets: ['source'],
  }), 5_000, 'Job source lookup');
  if (result?.disabled) return res.status(503).json({ error: 'Job read model unavailable', retryable: true });
  const allowed = new Set(JobSource.filter((source) => source.type !== 'Legal' && source.title !== 'Other').map((source) => source.title));
  const sources = (result?.facets?.sources || []).filter((source) => allowed.has(source.title));
  res.json({ sources, total: result?.pagination?.total || 0 });
});

export const getAgentReadiness = createAsyncHandler(async (req, res) => {
  const account = await accountForRequest(req);
  if (!account) return res.status(404).json({ error: 'Profile not found' });
  const profile = await decryptProfileApiKeys(account.autoBidProfile || {});
  const model = resolveDefaultModel(profile);
  const resumeProfileReady = Boolean(
    String(profile?.name || account.name || '').trim() &&
    (Array.isArray(profile?.careers) ? profile.careers.length > 0 : Boolean(profile?.career)),
  );
  const kit = resumeGeneratorConfigCollection
    ? await resumeGeneratorConfigCollection.findOne(
        { applierName: account.name },
        { projection: { _id: 1, config: 1 } },
      )
    : null;
  const submissionKitReady = Boolean(kit?.config && typeof kit.config === 'object');
  res.json({
    profile: { id: String(account._id || ''), name: String(account.name || ''), ready: true },
    ai: {
      ready: Boolean(model?.apiKey && model?.model),
      provider: String(model?.provider || ''),
      model: String(model?.model || ''),
    },
    resume: {
      ready: resumeProfileReady && submissionKitReady,
      profileReady: resumeProfileReady,
      submissionKitReady,
    },
  });
});

export const postResolveManualJob = createAsyncHandler(async (req, res) => {
  if (!jobsCollection) return res.status(503).json({ error: 'Database not ready' });
  const account = await accountForRequest(req);
  if (!account) return res.status(404).json({ error: 'Profile not found' });
  let url;
  try {
    url = canonicalJobUrl(req.body?.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const title = String(req.body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const company = String(req.body?.company || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const description = sanitizedJobDescription(req.body?.description);
  if (!title || description.length < 80) {
    return res.status(422).json({
      error: 'A usable job title and description could not be extracted. Retry, or save this job from Job Search.',
    });
  }
  const result = await createJobRecord({
    title,
    company: { name: company || new URL(url).hostname.replace(/^www\./, '') },
    applyLink: url,
    url,
    description,
    origin: 'agent-manual',
    status: [],
  });
  const payload = result.payload || {};
  const id = String(payload.insertedId || payload.existingId || '');
  if (!id) {
    const status = payload.duplicate ? 409 : Math.max(400, result.statusCode || 422);
    return res.status(status).json({ error: payload.reason || payload.error || 'Unable to save this job', retryable: payload.duplicate });
  }
  const saved = await jobsCollection.findOne(
    { _id: new DocumentId(id) },
    { projection: { title: 1, company: 1, applyLink: 1, url: 1, source: 1 } },
  );
  return res.status(payload.created ? 201 : 200).json({
    created: Boolean(payload.created),
    job: {
      id,
      title: String(saved?.title || title),
      company: String(saved?.company?.name || company),
      url: String(saved?.applyLink || saved?.url || url),
      source: String(saved?.source || 'Other'),
    },
  });
});

const emptyDashboard = {
  posted: 0,
  appliedToday: 0,
  applied7d: 0,
  scheduled: 0,
  activeRuns: 0,
  totalRuns: 0,
  inFlightJobs: 0,
  succeededToday: 0,
  bySource: {},
  runPipeline: { inProgress: 0, succeeded: 0, failed: 0, review: 0, scheduled: 0 },
  pipelineStages: {
    posted: 0,
    scheduled: 0,
    inRun: 0,
    submitted: 0,
    reviewPending: 0,
    error: 0,
  },
  applications7d: [],
  submissions7d: [],
  byStatus: {},
  jobs: [],
};

export const getAgentDashboard = createAsyncHandler(async (_req, res) => {
  res.json(emptyDashboard);
});

export const getAgentRuns = createAsyncHandler(async (_req, res) => {
  res.json({ runs: [] });
});

export const getAgentActivity = createAsyncHandler(async (_req, res) => {
  res.json({ activity: [] });
});

export const postAgentDeploy = createAsyncHandler(async (_req, res) => {
  res.status(410).json({
    error: "Agent deploy moved to Avalon. Queue jobs in the Agents Controller tab.",
  });
});

/**
 * POST /api/agents/chat — Avalon agent LLM proxy.
 * Uses the applier profile's API keys (Settings → Profile), not ai-bff env keys.
 */
export const postAgentChat = createAsyncHandler(async (req, res) => {
  const applierName = String(req.body?.applierName || "").trim();
  if (!applierName) {
    return res.status(400).json({ error: "applierName required" });
  }

  const acc = await findAccountByApplierName(applierName);
  if (!acc) {
    return res.status(404).json({ error: `No account named "${applierName}".` });
  }

  const profile = await decryptProfileApiKeys(acc.autoBidProfile || {});
  const { model: profileModel } = resolveDefaultModel(profile);
  const model = String(req.body?.model || "").trim() || profileModel;

  const openaiApiKey = String(profile.openaiApiKey || "").trim();
  const deepseekApiKey = String(profile.deepseekApiKey || "").trim();
  if (!openaiApiKey && !deepseekApiKey) {
    return res.status(400).json({
      error: "No OpenAI or DeepSeek API key in profile. Add one under Settings → Profile.",
    });
  }

  const { messages, system, temperature, maxTokens, responseSchema, runId, jobId, feature } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages required" });
  }

  const requestId = String(req.headers["x-request-id"] || req.body?.requestId || randomUUID());

  const upstream = await fetch(`${AI_BFF_URL}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getServiceAuthHeaders(AI_BFF_URL)),
      "x-request-id": requestId,
      ...(runId ? { "x-run-id": String(runId) } : {}),
      "x-applier-name": applierName,
      ...(jobId ? { "x-job-id": String(jobId) } : {}),
      ...(feature ? { "x-feature": String(feature) } : { "x-feature": "avalon-agent-chat" }),
    },
    body: JSON.stringify({
      model,
      system,
      messages,
      temperature,
      maxTokens,
      responseSchema,
      requestId,
      runId,
      applierName,
      jobId,
      feature: feature || "avalon-agent-chat",
      apiKeys: {
        ...(openaiApiKey ? { openai: openaiApiKey } : {}),
        ...(deepseekApiKey ? { deepseek: deepseekApiKey } : {}),
      },
    }),
  });

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = data?.error || data?.message || `AI request failed (${upstream.status})`;
    return res.status(upstream.status).json({ error: message });
  }

  return res.json(data);
});

export const agentControllerTest = {
  canonicalJobUrl,
  sanitizedJobDescription,
};

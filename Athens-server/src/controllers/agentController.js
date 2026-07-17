import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { jobsCollection, accountInfoCollection } from "../db/mongo.js";
import { JobSource } from "../config/jobSources.js";
import { DEEPSEEK_MODELS, listOpenAiModels } from "@nextoffer/shared/models";
import { createAsyncHandler } from "../utils/http.js";
import { findAccountByApplierName } from "../services/mail/credentials.js";
import { resolveDefaultModel } from "../services/llm/llmService.js";
import { decryptProfileApiKeys } from "../services/autoBidProfileSecrets.js";
import { decryptSecret } from "@nextoffer/shared/secretCrypto";

const AI_BFF_URL = (process.env.AI_BFF_URL || "http://127.0.0.1:3920").replace(/\/$/, "");

function toOid(id) {
  if (!id || !ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

function postedFilter(applierOid) {
  const and = [
    {
      $or: [
        { applyLink: { $regex: /^https?:\/\//i } },
        { url: { $regex: /^https?:\/\//i } },
      ],
    },
  ];
  if (applierOid) {
    and.push({
      $or: [
        { status: { $exists: false } },
        { status: { $not: { $elemMatch: { applier: applierOid } } } },
      ],
    });
  }
  return and.length === 1 ? and[0] : { $and: and };
}

async function resolveOpenAiKey(profileId) {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (!profileId || !accountInfoCollection) return envKey || null;
  if (!ObjectId.isValid(profileId)) return envKey || null;
  const doc = await accountInfoCollection.findOne(
    { _id: new ObjectId(profileId) },
    { projection: { "autoBidProfile.openaiApiKey": 1 } },
  );
  return decryptSecret(doc?.autoBidProfile?.openaiApiKey ?? '').trim() || envKey || null;
}

export const getAgentHealth = createAsyncHandler(async (_req, res) => {
  res.json({
    ok: true,
    mongoDb: process.env.MONGO_DB || "AthensDB",
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
  if (!jobsCollection) {
    return res.status(503).json({ error: "Database not ready" });
  }
  const applierOid = toOid(req.query.profileId);
  const rows = await jobsCollection
    .aggregate([
      { $match: postedFilter(applierOid) },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  const counts = {};
  let total = 0;
  for (const r of rows) {
    counts[r._id || "Other"] = r.count;
    total += r.count;
  }
  const sources = JobSource.filter(
    (s) => s.type !== "Legal" && s.title !== "Other" && (counts[s.title] || 0) > 0,
  )
    .map((s) => ({ title: s.title, type: s.type, posted: counts[s.title] || 0 }))
    .sort((a, b) => b.posted - a.posted);
  res.json({ sources, total });
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

  const profile = decryptProfileApiKeys(acc.autoBidProfile || {});
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

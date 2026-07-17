import { createHash } from "node:crypto";
import { accountInfoCollection, aiApiUsageCollection } from "../db/mongo.js";
import { createAsyncHandler } from "../utils/http.js";
import { decryptAccountDoc } from "../services/autoBidProfileSecrets.js";
import {
  buildAiUsageMatch,
  AI_USAGE_TOTALS_GROUP,
  AI_USAGE_BY_DAY_PIPELINE,
} from "../services/aiUsageQuery.js";

const EMPTY_TOTALS = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

const KEY_PROVIDERS = [
  { provider: "openai", field: "openaiApiKey" },
  { provider: "deepseek", field: "deepseekApiKey" },
];

function emptyUsageBucket() {
  return {
    ...EMPTY_TOTALS,
    lastCallAt: null,
    byProvider: [],
    byFeature: [],
  };
}

/** Mask a decrypted API key for display — never return the full secret. */
function maskApiKey(raw) {
  const key = String(raw || "").trim();
  if (!key) return null;
  if (key.length <= 8) return "••••••••";
  const prefix = key.slice(0, Math.min(7, Math.max(3, key.indexOf("-") + 1 || 3)));
  return `${prefix}…${key.slice(-4)}`;
}

function fingerprintApiKey(raw) {
  const key = String(raw || "").trim();
  if (!key) return null;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function describeKey(profile, field, provider) {
  const raw = String(profile?.[field] || "").trim();
  const configured = Boolean(raw);
  return {
    provider,
    configured,
    masked: configured ? maskApiKey(raw) : null,
    fingerprint: configured ? fingerprintApiKey(raw) : null,
  };
}

function roundCost(n) {
  return Math.round((Number(n) || 0) * 1_000_000) / 1_000_000;
}

/** Never return full API keys to the browser — mask for display. */
function serializeUsageRow(doc) {
  if (!doc) return null;
  const { apiKey, ...rest } = doc;
  return {
    ...rest,
    apiKey: maskApiKey(apiKey),
  };
}

export const getAiUsage = createAsyncHandler(async (req, res) => {
  if (!aiApiUsageCollection) {
    return res.status(503).json({ error: "Database not ready" });
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const match = buildAiUsageMatch(req.query);

  const rows = await aiApiUsageCollection
    .find(match)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  res.json({ rows: rows.map(serializeUsageRow), count: rows.length });
});

export const getAiUsageSummary = createAsyncHandler(async (req, res) => {
  if (!aiApiUsageCollection) {
    return res.status(503).json({ error: "Database not ready" });
  }

  const match = buildAiUsageMatch(req.query);

  const [totals, byProvider, byFeature, byDay] = await Promise.all([
    aiApiUsageCollection.aggregate([
      { $match: match },
      { $group: AI_USAGE_TOTALS_GROUP },
    ]).toArray(),
    aiApiUsageCollection.aggregate([
      { $match: match },
      {
        $group: {
          _id: { provider: "$provider", billedModel: "$billedModel" },
          calls: { $sum: 1 },
          inputTokens: { $sum: "$inputTokens" },
          cachedInputTokens: { $sum: "$cachedInputTokens" },
          outputTokens: { $sum: "$outputTokens" },
          totalTokens: { $sum: "$totalTokens" },
          costUsd: { $sum: "$costUsd" },
        },
      },
      { $sort: { costUsd: -1 } },
    ]).toArray(),
    aiApiUsageCollection.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$feature",
          calls: { $sum: 1 },
          costUsd: { $sum: "$costUsd" },
          totalTokens: { $sum: "$totalTokens" },
        },
      },
      { $sort: { costUsd: -1 } },
    ]).toArray(),
    aiApiUsageCollection.aggregate([
      { $match: match },
      ...AI_USAGE_BY_DAY_PIPELINE,
    ]).toArray(),
  ]);

  res.json({
    totals: totals[0] ?? { ...EMPTY_TOTALS },
    byProvider,
    byFeature,
    byDay,
  });
});

/**
 * GET /ai-usage/monitor
 * All registered users with configured API keys (masked) and LLM spend from ai_api_usage.
 */
export const getAiUsageMonitor = createAsyncHandler(async (req, res) => {
  if (!accountInfoCollection || !aiApiUsageCollection) {
    return res.status(503).json({ error: "Database not ready" });
  }

  const match = buildAiUsageMatch(req.query);

  const [accounts, byApplier, byApplierProvider, byApplierFeature, overallTotals] =
    await Promise.all([
      accountInfoCollection
        .find(
          {},
          {
            projection: {
              name: 1,
              tier: 1,
              vendorAllowed: 1,
              "autoBidProfile.fullName": 1,
              "autoBidProfile.email": 1,
              "autoBidProfile.openaiApiKey": 1,
              "autoBidProfile.deepseekApiKey": 1,
              "autoBidProfile.defaultProvider": 1,
              "autoBidProfile.defaultModel": 1,
              "autoBidProfile.updatedAt": 1,
            },
          },
        )
        .toArray(),
      aiApiUsageCollection
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: { $ifNull: ["$applierName", ""] },
              calls: { $sum: 1 },
              inputTokens: { $sum: "$inputTokens" },
              cachedInputTokens: { $sum: "$cachedInputTokens" },
              outputTokens: { $sum: "$outputTokens" },
              totalTokens: { $sum: "$totalTokens" },
              costUsd: { $sum: "$costUsd" },
              lastCallAt: { $max: "$createdAt" },
            },
          },
        ])
        .toArray(),
      aiApiUsageCollection
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                applierName: { $ifNull: ["$applierName", ""] },
                provider: { $ifNull: ["$provider", "unknown"] },
                billedModel: { $ifNull: ["$billedModel", "unknown"] },
              },
              calls: { $sum: 1 },
              inputTokens: { $sum: "$inputTokens" },
              cachedInputTokens: { $sum: "$cachedInputTokens" },
              outputTokens: { $sum: "$outputTokens" },
              totalTokens: { $sum: "$totalTokens" },
              costUsd: { $sum: "$costUsd" },
            },
          },
          { $sort: { costUsd: -1 } },
        ])
        .toArray(),
      aiApiUsageCollection
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                applierName: { $ifNull: ["$applierName", ""] },
                feature: { $ifNull: ["$feature", "unknown"] },
              },
              calls: { $sum: 1 },
              costUsd: { $sum: "$costUsd" },
              totalTokens: { $sum: "$totalTokens" },
            },
          },
          { $sort: { costUsd: -1 } },
        ])
        .toArray(),
      aiApiUsageCollection
        .aggregate([{ $match: match }, { $group: AI_USAGE_TOTALS_GROUP }])
        .toArray(),
    ]);

  const usageByName = new Map();
  for (const row of byApplier) {
    const name = String(row._id || "").trim();
    usageByName.set(name, {
      calls: row.calls || 0,
      inputTokens: row.inputTokens || 0,
      cachedInputTokens: row.cachedInputTokens || 0,
      outputTokens: row.outputTokens || 0,
      totalTokens: row.totalTokens || 0,
      costUsd: roundCost(row.costUsd),
      lastCallAt: row.lastCallAt
        ? row.lastCallAt instanceof Date
          ? row.lastCallAt.toISOString()
          : String(row.lastCallAt)
        : null,
      byProvider: [],
      byFeature: [],
    });
  }

  for (const row of byApplierProvider) {
    const name = String(row._id?.applierName || "").trim();
    const bucket = usageByName.get(name) || emptyUsageBucket();
    if (!usageByName.has(name)) usageByName.set(name, bucket);
    bucket.byProvider.push({
      provider: row._id?.provider || "unknown",
      billedModel: row._id?.billedModel || "unknown",
      calls: row.calls || 0,
      inputTokens: row.inputTokens || 0,
      cachedInputTokens: row.cachedInputTokens || 0,
      outputTokens: row.outputTokens || 0,
      totalTokens: row.totalTokens || 0,
      costUsd: roundCost(row.costUsd),
    });
  }

  for (const row of byApplierFeature) {
    const name = String(row._id?.applierName || "").trim();
    const bucket = usageByName.get(name) || emptyUsageBucket();
    if (!usageByName.has(name)) usageByName.set(name, bucket);
    bucket.byFeature.push({
      feature: row._id?.feature || "unknown",
      calls: row.calls || 0,
      costUsd: roundCost(row.costUsd),
      totalTokens: row.totalTokens || 0,
    });
  }

  /** @type {Map<string, { provider: string, masked: string, fingerprint: string, users: string[], calls: number, costUsd: number, totalTokens: number }>} */
  const keyIndex = new Map();

  const users = accounts
    .map((raw) => {
      const doc = decryptAccountDoc(raw);
      const name = String(doc?.name || "").trim();
      if (!name) return null;
      const profile = doc.autoBidProfile || {};
      const keys = KEY_PROVIDERS.map(({ provider, field }) =>
        describeKey(profile, field, provider),
      );
      const usage = usageByName.get(name) || emptyUsageBucket();

      for (const key of keys) {
        if (!key.configured || !key.fingerprint) continue;
        const mapKey = `${key.provider}:${key.fingerprint}`;
        let entry = keyIndex.get(mapKey);
        if (!entry) {
          entry = {
            provider: key.provider,
            masked: key.masked,
            fingerprint: key.fingerprint,
            users: [],
            calls: 0,
            costUsd: 0,
            totalTokens: 0,
          };
          keyIndex.set(mapKey, entry);
        }
        if (!entry.users.includes(name)) entry.users.push(name);
        // Attribute this user's provider spend to the configured key for that provider.
        for (const p of usage.byProvider) {
          if (p.provider === key.provider) {
            entry.calls += p.calls || 0;
            entry.costUsd = roundCost(entry.costUsd + (p.costUsd || 0));
            entry.totalTokens += p.totalTokens || 0;
          }
        }
      }

      return {
        name,
        tier: doc.tier ?? null,
        vendorAllowed: Boolean(doc.vendorAllowed),
        fullName: profile.fullName || null,
        email: profile.email || null,
        defaultProvider: profile.defaultProvider || null,
        defaultModel: profile.defaultModel || null,
        profileUpdatedAt: profile.updatedAt || null,
        keys: keys.map(({ fingerprint: _fp, ...rest }) => rest),
        usage,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.usage.costUsd || 0) - (a.usage.costUsd || 0) || a.name.localeCompare(b.name));

  const knownNames = new Set(users.map((u) => u.name));
  const unassigned = [];
  for (const [name, usage] of usageByName.entries()) {
    if (!name || knownNames.has(name)) continue;
    unassigned.push({ name: name || "(no applier)", usage });
  }
  unassigned.sort((a, b) => (b.usage.costUsd || 0) - (a.usage.costUsd || 0));

  const blankApplier = usageByName.get("");
  if (blankApplier && (blankApplier.calls || 0) > 0) {
    unassigned.unshift({ name: "(no applier)", usage: blankApplier });
  }

  const apiKeys = [...keyIndex.values()].sort(
    (a, b) => (b.costUsd || 0) - (a.costUsd || 0) || a.provider.localeCompare(b.provider),
  );

  const totals = overallTotals[0] ?? { ...EMPTY_TOTALS };
  totals.costUsd = roundCost(totals.costUsd);

  res.json({
    totals: {
      ...totals,
      registeredUsers: users.length,
      usersWithKeys: users.filter((u) => u.keys.some((k) => k.configured)).length,
      usersWithUsage: users.filter((u) => (u.usage.calls || 0) > 0).length,
      configuredKeys: apiKeys.length,
    },
    users,
    apiKeys,
    unassigned,
  });
});

export function parseAiUsageDate(value) {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Build Mongo match filter from ai-usage query params. */
export function buildAiUsageMatch(query = {}) {
  const applierName = String(query.applierName || "").trim() || undefined;
  const runId = String(query.runId || "").trim() || undefined;
  const feature = String(query.feature || "").trim() || undefined;
  const since = parseAiUsageDate(query.since);
  const until = parseAiUsageDate(query.until);

  const match = {};
  if (applierName) match.applierName = applierName;
  if (runId) match.runId = runId;
  if (feature) match.feature = feature;
  if (since || until) {
    match.createdAt = {};
    if (since) match.createdAt.$gte = since;
    if (until) match.createdAt.$lte = until;
  }

  return match;
}

export const AI_USAGE_TOTALS_GROUP = {
  _id: null,
  calls: { $sum: 1 },
  inputTokens: { $sum: "$inputTokens" },
  cachedInputTokens: { $sum: "$cachedInputTokens" },
  outputTokens: { $sum: "$outputTokens" },
  totalTokens: { $sum: "$totalTokens" },
  costUsd: { $sum: "$costUsd" },
};

export const AI_USAGE_BY_DAY_PIPELINE = [
  {
    $group: {
      _id: {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
      },
      calls: { $sum: 1 },
      inputTokens: { $sum: "$inputTokens" },
      cachedInputTokens: { $sum: "$cachedInputTokens" },
      outputTokens: { $sum: "$outputTokens" },
      totalTokens: { $sum: "$totalTokens" },
      costUsd: { $sum: "$costUsd" },
    },
  },
  { $sort: { _id: 1 } },
];

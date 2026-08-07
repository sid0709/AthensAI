/** Format USD cost for AI usage / generation UI. */
export function formatRunCost(costUsd: number): string {
  if (!Number.isFinite(costUsd)) return "$0.0000";
  if (costUsd >= 0.01) return `$${costUsd.toFixed(4)}`;
  if (costUsd === 0) return "$0.0000";
  return `$${costUsd.toFixed(4)}`;
}

/** DeepSeek bills input as cache hit vs cache miss; OpenAI uses Input / Cached. */
export function usageTokenLabels(model?: string | null): { input: string; cached: string } {
  if (model && /^deepseek/i.test(model)) {
    return { input: "Input (cache miss)", cached: "Input (cache hit)" };
  }
  return { input: "Input", cached: "Cached" };
}

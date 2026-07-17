import type { RunUsage } from "../../../types/agent";

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

export function usageFromEvent(e: Record<string, unknown>): RunUsage {
  const costUsd = e.costUsd as number;
  return {
    model: e.model as string | undefined,
    inputTokens: e.inputTokens as number,
    cachedTokens: e.cachedTokens as number,
    outputTokens: e.outputTokens as number,
    totalTokens: e.totalTokens as number,
    costUsd,
    costLabel: (e.costLabel as string | undefined) ?? formatRunCost(costUsd),
  };
}

export function sumRunUsage(usages: (RunUsage | null | undefined)[]): RunUsage | null {
  const items = usages.filter((u): u is RunUsage => u != null && Number.isFinite(u.costUsd));
  if (!items.length) return null;
  const sum = items.reduce(
    (acc, u) => ({
      model: u.model ?? acc.model,
      inputTokens: acc.inputTokens + u.inputTokens,
      cachedTokens: acc.cachedTokens + u.cachedTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
      costUsd: acc.costUsd + u.costUsd,
    }),
    { inputTokens: 0, cachedTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, model: items[0].model },
  );
  return { ...sum, costLabel: formatRunCost(sum.costUsd) };
}

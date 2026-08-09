export type GenerationUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
};

export function emptyUsage(): GenerationUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
}

export function addUsage(
  total: GenerationUsage,
  step:
    | {
        promptTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
        cost?: number | null;
      }
    | null
    | undefined,
): GenerationUsage {
  if (!step) return total;
  return {
    promptTokens: total.promptTokens + Number(step.promptTokens || 0),
    completionTokens:
      total.completionTokens + Number(step.completionTokens || 0),
    totalTokens: total.totalTokens + Number(step.totalTokens || 0),
    cost: total.cost + Number(step.cost || 0),
  };
}

export function usageWithCost(
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null,
): GenerationUsage {
  return {
    promptTokens: Number(usage?.promptTokens || 0),
    completionTokens: Number(usage?.completionTokens || 0),
    totalTokens: Number(usage?.totalTokens || 0),
    cost: 0,
  };
}

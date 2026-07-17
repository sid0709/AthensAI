import { findPricing } from "@nextoffer/shared/pricing";

export interface AgentPricingRates {
  promptPer1M: number;
  completionPer1M: number;
  cachedPromptPer1M?: number;
}

interface AgentModelPricing {
  provider: "openai" | "deepseek";
  label: string;
  rates: AgentPricingRates;
}

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const FALLBACK_GPT_MODEL = "gpt-4o-mini";

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4-turbo": "GPT-4 Turbo",
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 Mini",
  "gpt-3.5-turbo": "GPT-3.5 Turbo",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-reasoner": "DeepSeek Reasoner",
  "deepseek-chat": "DeepSeek Chat",
};

function ratesForModel(model: string): AgentPricingRates {
  const row = findPricing(model);
  if (row) {
    return {
      promptPer1M: row.input,
      completionPer1M: row.output,
      cachedPromptPer1M: row.cachedInput ?? row.input,
    };
  }
  if (model.startsWith("gpt-")) {
    const fallback = findPricing(FALLBACK_GPT_MODEL);
    return {
      promptPer1M: fallback?.input ?? 0.15,
      completionPer1M: fallback?.output ?? 0.6,
      cachedPromptPer1M: fallback?.cachedInput ?? fallback?.input ?? 0.15,
    };
  }
  if (model.startsWith("deepseek-")) {
    const fallback = findPricing(DEFAULT_DEEPSEEK_MODEL);
    return {
      promptPer1M: fallback?.input ?? 0.14,
      completionPer1M: fallback?.output ?? 0.28,
      cachedPromptPer1M: fallback?.cachedInput ?? fallback?.input ?? 0.14,
    };
  }
  return { promptPer1M: 1, completionPer1M: 3, cachedPromptPer1M: 1 };
}

/**
 * Estimated rates for display before the first server response returns billed-model pricing.
 */
export function resolveAgentModelPricing(model?: string | null): AgentModelPricing | null {
  const id = model?.trim();
  if (!id) return null;

  const provider = id.startsWith("deepseek-") ? "deepseek" : "openai";
  const label = MODEL_LABELS[id] ?? id;
  return {
    provider,
    label,
    rates: ratesForModel(id),
  };
}

export function formatAgentRate(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

import { costFromUsage, findPricing } from '@nextoffer/shared/pricing';
import type { AiProviderId, CostBreakdown, ModelInfo, TokenUsage } from './types.js';

export interface ModelPricing {
  provider: AiProviderId;
  label: string;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  contextWindow: number;
  promptPer1M: number;
  completionPer1M: number;
}

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

const FALLBACK_GPT_MODEL = 'gpt-4o-mini';

interface ModelMeta {
  provider: AiProviderId;
  label: string;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  contextWindow: number;
}

const MODEL_META: Record<string, ModelMeta> = {
  'gpt-4o': {
    provider: 'openai',
    label: 'GPT-4o',
    supportsVision: true,
    supportsStructuredOutput: true,
    contextWindow: 128_000,
  },
  'gpt-4o-mini': {
    provider: 'openai',
    label: 'GPT-4o Mini',
    supportsVision: true,
    supportsStructuredOutput: true,
    contextWindow: 128_000,
  },
  'gpt-4-turbo': {
    provider: 'openai',
    label: 'GPT-4 Turbo',
    supportsVision: true,
    supportsStructuredOutput: true,
    contextWindow: 128_000,
  },
  'gpt-4.1': {
    provider: 'openai',
    label: 'GPT-4.1',
    supportsVision: true,
    supportsStructuredOutput: true,
    contextWindow: 1_047_576,
  },
  'gpt-4.1-mini': {
    provider: 'openai',
    label: 'GPT-4.1 Mini',
    supportsVision: true,
    supportsStructuredOutput: true,
    contextWindow: 1_047_576,
  },
  'gpt-3.5-turbo': {
    provider: 'openai',
    label: 'GPT-3.5 Turbo',
    supportsVision: false,
    supportsStructuredOutput: false,
    contextWindow: 16_385,
  },
  'deepseek-v4-flash': {
    provider: 'deepseek',
    label: 'DeepSeek V4 Flash',
    supportsVision: false,
    supportsStructuredOutput: true,
    contextWindow: 64_000,
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    label: 'DeepSeek Reasoner',
    supportsVision: false,
    supportsStructuredOutput: true,
    contextWindow: 64_000,
  },
  'deepseek-chat': {
    provider: 'deepseek',
    label: 'DeepSeek Chat (deprecated)',
    supportsVision: false,
    supportsStructuredOutput: true,
    contextWindow: 64_000,
  },
};

/** @deprecated Use MODEL_META + findPricing instead. Kept for lib exports. */
export const MODEL_CATALOG: Record<string, ModelPricing> = Object.fromEntries(
  Object.entries(MODEL_META).map(([id, meta]) => {
    const rates = findPricing(id);
    return [
      id,
      {
        ...meta,
        promptPer1M: rates?.input ?? 0,
        completionPer1M: rates?.output ?? 0,
      },
    ];
  }),
);

function ratesForModel(model: string): { promptPer1M: number; completionPer1M: number } {
  const row = findPricing(model);
  if (row) {
    return { promptPer1M: row.input, completionPer1M: row.output };
  }
  if (model.startsWith('gpt-')) {
    const fallback = findPricing(FALLBACK_GPT_MODEL);
    return {
      promptPer1M: fallback?.input ?? 0.15,
      completionPer1M: fallback?.output ?? 0.6,
    };
  }
  if (model.startsWith('deepseek-')) {
    const fallback = findPricing(DEFAULT_DEEPSEEK_MODEL);
    return {
      promptPer1M: fallback?.input ?? 0.14,
      completionPer1M: fallback?.output ?? 0.28,
    };
  }
  return { promptPer1M: 1, completionPer1M: 3 };
}

function metaForModel(model: string): ModelMeta {
  const known = MODEL_META[model];
  if (known) return known;

  if (model.startsWith('deepseek-')) {
    return MODEL_META[DEFAULT_DEEPSEEK_MODEL];
  }

  return {
    provider: 'openai',
    label: model,
    supportsVision: model.startsWith('gpt-4o') || model.startsWith('gpt-4.1'),
    supportsStructuredOutput: true,
    contextWindow: model.startsWith('gpt-4.1') ? 1_047_576 : 128_000,
  };
}

export function resolveModelPricing(model: string): ModelPricing {
  const meta = metaForModel(model);
  const rates = ratesForModel(model);
  return { ...meta, ...rates };
}

export function calculateCost(model: string, usage: TokenUsage): CostBreakdown {
  const rawUsage = {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    ...(usage.cachedTokens != null && usage.cachedTokens > 0
      ? { prompt_tokens_details: { cached_tokens: usage.cachedTokens } }
      : {}),
  };

  const priced = costFromUsage(model, rawUsage);
  const rates = findPricing(model) ?? (model.startsWith('gpt-')
    ? findPricing(FALLBACK_GPT_MODEL)
    : model.startsWith('deepseek-')
      ? findPricing(DEFAULT_DEEPSEEK_MODEL)
      : null);

  if (!rates) {
    return {
      promptUsd: 0,
      completionUsd: 0,
      totalUsd: 0,
      currency: 'USD',
      rates: { promptPer1M: 0, completionPer1M: 0 },
    };
  }

  const cachedRate = rates.cachedInput ?? rates.input;
  const promptUsd =
    (priced.inputTokens * rates.input + priced.cachedTokens * cachedRate) / 1_000_000;
  const completionUsd = (priced.outputTokens * rates.output) / 1_000_000;

  return {
    promptUsd: roundUsd(promptUsd),
    completionUsd: roundUsd(completionUsd),
    totalUsd: roundUsd(priced.costUsd),
    currency: 'USD',
    rates: {
      promptPer1M: rates.input,
      completionPer1M: rates.output,
    },
  };
}

export function listModels(): ModelInfo[] {
  return Object.keys(MODEL_META)
    .filter((id) => id !== 'deepseek-chat')
    .map((id) => {
      const pricing = resolveModelPricing(id);
      return {
        id,
        provider: pricing.provider,
        label: pricing.label,
        supportsVision: pricing.supportsVision,
        supportsStructuredOutput: pricing.supportsStructuredOutput,
        contextWindow: pricing.contextWindow,
        pricing: {
          promptPer1M: pricing.promptPer1M,
          completionPer1M: pricing.completionPer1M,
          currency: 'USD' as const,
        },
      };
    });
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

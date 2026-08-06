import { DEEPSEEK_MODELS } from '@nextoffer/shared/models';

export type LlmProviderId = 'openai' | 'deepseek';

export type LlmProviderConfig = {
  id: LlmProviderId;
  label: string;
  keyField: 'openaiApiKey' | 'deepseekApiKey';
  models: string[] | null;
};

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderConfig> = {
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
    models: [...DEEPSEEK_MODELS],
  },
};

export function getLlmProvider(id: string): LlmProviderConfig {
  return LLM_PROVIDERS[id as LlmProviderId] || LLM_PROVIDERS.openai;
}

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return value === 'openai' || value === 'deepseek';
}

import type { AiKitConfig } from '../types.js';
import { DEFAULT_DEEPSEEK_MODEL, resolveModelPricing } from '../pricing.js';
import { createOpenAiCompatibleProvider } from './base.js';
import type { AiProvider } from './base.js';

export function createProviders(config: AiKitConfig): AiProvider[] {
  return [
    createOpenAiCompatibleProvider('openai', config.openaiApiKey, config.openaiBaseUrl ?? 'https://api.openai.com/v1'),
    createOpenAiCompatibleProvider(
      'deepseek',
      config.deepseekApiKey,
      config.deepseekBaseUrl ?? 'https://api.deepseek.com',
    ),
  ];
}

export function resolveProvider(providers: AiProvider[], model: string): AiProvider {
  const match = providers.find((provider) => provider.isConfigured() && provider.supportsModel(model));
  if (match) return match;

  const configured = providers.filter((p) => p.isConfigured());
  if (configured.length === 0) {
    throw new Error(
      'No AI provider API keys configured. Set OPENAI_API_KEY and/or DEEPSEEK_API_KEY in ai-bff/.env (or pass apiKeys per request). Placeholder values like sk-... are ignored.',
    );
  }

  const expected = resolveModelPricing(model).provider;
  throw new Error(
    `Model "${model}" requires the "${expected}" provider, which is not configured. ` +
      `Set ${expected === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'} or change DEFAULT_MODEL / request model to one of: ` +
      configured.flatMap((p) => (p.id === 'openai' ? ['gpt-4o-mini'] : [DEFAULT_DEEPSEEK_MODEL, 'deepseek-reasoner'])).join(', '),
  );
}

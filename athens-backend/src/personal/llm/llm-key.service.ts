import { Injectable } from '@nestjs/common';
import { isDeepSeekModel, listOpenAiModels } from '@nextoffer/shared/models';
import {
  getLlmProvider,
  type LlmProviderId,
} from '../constants/llm-providers.constants';
import { asText } from '../mappers/as-text';

const MODEL_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class LlmKeyService {
  private readonly modelCache = new Map<
    string,
    { at: number; models: string[] }
  >();

  isModelCompatible(provider: LlmProviderId, model: string): boolean {
    const modelId = asText(model).trim();
    if (!modelId) return false;
    return provider === 'deepseek'
      ? isDeepSeekModel(modelId)
      : !isDeepSeekModel(modelId);
  }

  async listModels(
    provider: LlmProviderId,
    apiKey: string,
    force = false,
  ): Promise<string[]> {
    const p = getLlmProvider(provider);
    if (Array.isArray(p.models)) return p.models;
    if (!apiKey) throw new Error(`No API key configured for ${p.label}.`);

    const cacheKey = `${p.id}:${apiKey.slice(-12)}`;
    const cached = this.modelCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < MODEL_TTL_MS) {
      return cached.models;
    }

    const catalog = await listOpenAiModels(apiKey);
    const models = catalog
      .map((m) => asText(m.id))
      .filter(Boolean)
      .sort();
    this.modelCache.set(cacheKey, { at: Date.now(), models });
    return models;
  }

  async verifyKey(input: {
    provider: LlmProviderId;
    apiKey: string;
    model?: string;
  }): Promise<{ ok: boolean; status: number; message: string }> {
    const p = getLlmProvider(input.provider);
    const apiKey = asText(input.apiKey).trim();
    if (!apiKey) {
      return {
        ok: false,
        status: 400,
        message: `No ${p.label} API key provided.`,
      };
    }

    try {
      if (p.id === 'openai') {
        const catalog = await listOpenAiModels(apiKey);
        const requested = asText(input.model).trim();
        if (requested && !catalog.some((entry) => entry.id === requested)) {
          return {
            ok: false,
            status: 400,
            message: `${requested} is not available to this OpenAI API key.`,
          };
        }
        return {
          ok: true,
          status: 200,
          message: `${p.label} key is valid.`,
        };
      }

      // DeepSeek: catalog is fixed; a missing key is the only hard fail here.
      // Full chat probe for DeepSeek is optional; Nest AI path records usage locally.
      return {
        ok: true,
        status: 200,
        message: `${p.label} key accepted (catalog provider).`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 0,
        message: `Could not validate ${p.label} key: ${message}`,
      };
    }
  }
}

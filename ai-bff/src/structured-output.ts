import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { AiProviderId, JsonSchemaDefinition } from './types.js';

type ResponseFormat = ChatCompletionCreateParamsNonStreaming['response_format'];

/**
 * OpenAI strict json_schema requires every key in `properties` to appear in `required`.
 * DeepSeek uses prompt-only JSON and is unaffected — this runs only on the OpenAI path.
 */
export function normalizeStrictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema };

  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const props = out.properties as Record<string, Record<string, unknown>>;
    const normalizedProps: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(props)) {
      normalizedProps[key] =
        value && typeof value === 'object' ? normalizeStrictJsonSchema(value) : value;
    }
    out.properties = normalizedProps;
    out.required = Object.keys(normalizedProps);
    out.additionalProperties = false;
  }

  if (out.type === 'array' && out.items && typeof out.items === 'object') {
    out.items = normalizeStrictJsonSchema(out.items as Record<string, unknown>);
  }

  return out;
}

export function parseStructuredContent(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return undefined;
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function schemaInstruction(responseSchema: JsonSchemaDefinition): string {
  return [
    'Return valid JSON only (no markdown) matching this schema:',
    JSON.stringify(responseSchema.schema),
  ].join('\n');
}

function augmentMessagesForSchema(
  messages: ChatCompletionMessageParam[],
  responseSchema: JsonSchemaDefinition,
): ChatCompletionMessageParam[] {
  const hint = schemaInstruction(responseSchema);
  const copy = [...messages];
  const systemIdx = copy.findIndex((m) => m.role === 'system');
  if (systemIdx >= 0) {
    const existing = copy[systemIdx];
    copy[systemIdx] = {
      ...existing,
      content: `${typeof existing.content === 'string' ? existing.content : ''}\n\n${hint}`,
    };
    return copy;
  }
  return [{ role: 'system', content: hint }, ...copy];
}

export function prepareStructuredChat(
  providerId: AiProviderId,
  messages: ChatCompletionMessageParam[],
  responseSchema?: JsonSchemaDefinition,
): { messages: ChatCompletionMessageParam[]; responseFormat: ResponseFormat } {
  if (!responseSchema) {
    return { messages, responseFormat: undefined };
  }

  if (providerId === 'openai') {
    const strict = responseSchema.strict ?? true;
    const schema = strict
      ? normalizeStrictJsonSchema(responseSchema.schema)
      : responseSchema.schema;
    return {
      messages,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: responseSchema.name,
          description: responseSchema.description,
          schema,
          strict,
        },
      },
    };
  }

  // DeepSeek does not support json_schema — use JSON mode + schema in prompt
  return {
    messages: augmentMessagesForSchema(messages, responseSchema),
    responseFormat: { type: 'json_object' },
  };
}

/** Prompt-only JSON (no response_format) for providers/models that reject JSON mode. */
export function preparePromptOnlyStructured(
  messages: ChatCompletionMessageParam[],
  responseSchema: JsonSchemaDefinition,
): ChatCompletionMessageParam[] {
  return augmentMessagesForSchema(messages, responseSchema);
}

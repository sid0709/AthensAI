export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionInput = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** openai | deepseek — selects API base URL. */
  provider?: 'openai' | 'deepseek';
  jsonMode?: boolean;
  /**
   * OpenAI structured outputs (`json_schema`). When set, preferred over jsonMode
   * for openai; deepseek falls back to json_object.
   */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  temperature?: number;
  /**
   * DeepSeek V4 thinking mode. Defaults to disabled (faster; needed for reliable
   * JSON batch work). OpenAI ignores this field.
   */
  thinking?: 'enabled' | 'disabled';
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
};

export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  usage: ChatUsage | null;
};

/** OpenAI-compatible chat stream chunks (provider → Nest). */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      model: string;
      usage: ChatUsage | null;
      durationMs: number;
      ttftMs: number | null;
    };

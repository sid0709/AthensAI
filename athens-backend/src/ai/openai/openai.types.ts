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
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
};

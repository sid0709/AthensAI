import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

export type AiProviderId = 'openai' | 'deepseek';

export interface ImageInput {
  /** Remote URL or data URL (data:image/...;base64,...) */
  url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  /** JSON Schema object describing the expected response shape */
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  /** Attach images to a user turn (vision models) */
  images?: ImageInput[];
}

export interface ChatRequest {
  model?: string;
  /** Shorthand system instruction; prepended unless messages already include system */
  system?: string;
  messages: ChatMessageInput[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  /** Tool / function schemas the model may call */
  tools?: ChatCompletionTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Structured output schema (JSON Schema) */
  responseSchema?: JsonSchemaDefinition;
  /** OpenAI-compatible JSON object mode (no schema) */
  jsonMode?: boolean;
  stream?: boolean;
  /** Per-request provider keys (server-to-server; overrides env when set). */
  apiKeys?: {
    openai?: string;
    deepseek?: string;
  };
  /** Correlation / attribution (forwarded from proxy or client). */
  requestId?: string;
  runId?: string;
  applierName?: string;
  jobId?: string;
  feature?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface CostBreakdown {
  promptUsd: number;
  completionUsd: number;
  totalUsd: number;
  currency: 'USD';
  /** Price sheet used (per 1M tokens) */
  rates: {
    promptPer1M: number;
    completionPer1M: number;
  };
}

export interface ChatUsage extends TokenUsage {
  cost: CostBreakdown;
}

export interface ChatResponse {
  id: string;
  requestId: string;
  requestedModel: string;
  billedModel: string;
  modelMismatch: boolean;
  provider: AiProviderId;
  /** Billed model ID (alias for billedModel, kept for compatibility). */
  model: string;
  content: string | null;
  /** Parsed JSON when responseSchema was requested */
  structured?: unknown;
  finishReason: string | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage: ChatUsage;
  raw?: unknown;
}

export interface ModelInfo {
  id: string;
  provider: AiProviderId;
  label: string;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  contextWindow: number;
  pricing: {
    promptPer1M: number;
    completionPer1M: number;
    currency: 'USD';
  };
}

export interface AiKitConfig {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  defaultModel?: string;
}

export type ProviderChatParams = {
  model: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  tools?: ChatCompletionTool[];
  toolChoice?: ChatRequest['toolChoice'];
  responseSchema?: JsonSchemaDefinition;
  jsonMode?: boolean;
  stream?: boolean;
};

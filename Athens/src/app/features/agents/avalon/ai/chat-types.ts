export interface JsonSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatRequest {
  model?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseSchema?: JsonSchemaDefinition;
  /** Abort the request when the caller's run is stopped (auto-run Stop). */
  signal?: AbortSignal;
  runId?: string;
  jobId?: string;
  feature?: string;
}

export interface ChatResponse {
  requestId?: string;
  requestedModel?: string;
  billedModel?: string;
  modelMismatch?: boolean;
  provider?: string;
  model?: string;
  structured?: {
    fields?: Array<Record<string, unknown>> | Array<{ id: string; script: string }>;
    script?: string;
  };
  usage?: {
    promptTokens: number;
    cachedTokens?: number;
    completionTokens: number;
    totalTokens: number;
    cost?: {
      totalUsd: number;
      currency: string;
      rates?: {
        promptPer1M: number;
        completionPer1M: number;
      };
    };
  };
}

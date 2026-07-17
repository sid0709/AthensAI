import { z } from 'zod';
import type { ChatRequest } from './types.js';

const imageInputSchema = z.object({
  url: z.string().min(1),
  detail: z.enum(['auto', 'low', 'high']).optional(),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  images: z.array(imageInputSchema).optional(),
});

const jsonSchemaDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  schema: z.record(z.unknown()),
  strict: z.boolean().optional(),
});

const toolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

export const chatRequestSchema = z.object({
  model: z.string().min(1).optional(),
  system: z.string().optional(),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  tools: z.array(toolSchema).optional(),
  toolChoice: z
    .union([
      z.enum(['auto', 'none', 'required']),
      z.object({
        type: z.literal('function'),
        function: z.object({ name: z.string().min(1) }),
      }),
    ])
    .optional(),
  responseSchema: jsonSchemaDefinitionSchema.optional(),
  jsonMode: z.boolean().optional(),
  stream: z.boolean().optional(),
  apiKeys: z
    .object({
      openai: z.string().optional(),
      deepseek: z.string().optional(),
    })
    .optional(),
  requestId: z.string().optional(),
  runId: z.string().optional(),
  applierName: z.string().optional(),
  jobId: z.string().optional(),
  feature: z.string().optional(),
});

export type ParsedChatRequest = z.infer<typeof chatRequestSchema>;

export function parseChatRequest(body: unknown): ChatRequest {
  return chatRequestSchema.parse(body);
}

export const estimateRequestSchema = z.object({
  model: z.string().min(1).optional(),
  promptText: z.string().min(1),
  expectedCompletionTokens: z.number().int().nonnegative().default(256),
});

export type EstimateRequest = z.infer<typeof estimateRequestSchema>;

/** Rough token estimate (~4 chars per token for English). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

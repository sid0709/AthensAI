import { API_BASE } from "@/lib/api-base";
import { AI_BFF_URL } from "./config";
import type { ChatRequest, ChatResponse } from "./chat-types";
import { getProfileApplierName, resolveChatModel } from "./model";
import { getAgentRunContext } from "./run-context";

const AGENTS_CHAT_URL = `${API_BASE.replace(/\/$/, "")}/agents/chat`;

export async function chatCompletion(request: ChatRequest): Promise<ChatResponse> {
  const model = resolveChatModel(request.model);
  const applierName = getProfileApplierName();
  const ctx = getAgentRunContext();
  const runId = request.runId ?? ctx.runId;
  const jobId = request.jobId ?? ctx.jobId;
  const feature = request.feature ?? ctx.feature;

  const payload = {
    ...(model ? { model } : {}),
    system: request.system,
    messages: request.messages,
    ...(request.temperature != null ? { temperature: request.temperature } : {}),
    ...(request.maxTokens != null ? { maxTokens: request.maxTokens } : {}),
    responseSchema: request.responseSchema,
    ...(runId ? { runId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(feature ? { feature } : {}),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (runId) headers["x-run-id"] = runId;
  if (jobId) headers["x-job-id"] = jobId;
  if (feature) headers["x-feature"] = feature;

  const response = applierName
    ? await fetch(AGENTS_CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ applierName, ...payload }),
        signal: request.signal,
      })
    : await fetch(`${AI_BFF_URL}/v1/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: request.signal,
      });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `AI request failed (${response.status})`);
  }

  const data = (await response.json()) as ChatResponse;
  const billedModel = data.billedModel ?? data.model ?? model;
  return {
    ...data,
    model: billedModel,
    billedModel,
    requestedModel: data.requestedModel ?? model,
    modelMismatch: data.modelMismatch ?? (model != null && billedModel != null && model !== billedModel),
  };
}

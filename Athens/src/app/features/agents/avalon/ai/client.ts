import { API_BASE } from "@/lib/api-base";
import type { ChatRequest, ChatResponse } from "./chat-types";
import { getProfileApplierName, getProfileId } from "./model";
import { getAgentRunContext } from "./run-context";

const AGENTS_CHAT_URL = `${API_BASE.replace(/\/$/, "")}/agents/chat`;

export async function chatCompletion(request: ChatRequest): Promise<ChatResponse> {
  const applierName = getProfileApplierName();
  const profileId = getProfileId();
  if (!applierName) {
    throw new Error("Select an applier with a default AI model before running the agent.");
  }
  const ctx = getAgentRunContext();
  const runId = request.runId ?? ctx.runId;
  const jobId = request.jobId ?? ctx.jobId;
  const feature = request.feature ?? ctx.feature;

  const payload = {
    system: request.system,
    messages: request.messages,
    ...(request.temperature != null ? { temperature: request.temperature } : {}),
    responseSchema: request.responseSchema,
    ...(runId ? { runId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(feature ? { feature } : {}),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (runId) headers["x-run-id"] = runId;
  if (jobId) headers["x-job-id"] = jobId;
  if (feature) headers["x-feature"] = feature;

  const response = await fetch(AGENTS_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ applierName, ...(profileId ? { profileId } : {}), ...payload }),
    signal: request.signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `AI request failed (${response.status})`);
  }

  const data = (await response.json()) as ChatResponse;
  const billedModel = data.billedModel ?? data.model;
  return {
    ...data,
    model: billedModel,
    billedModel,
    requestedModel: data.requestedModel,
    modelMismatch: data.modelMismatch,
  };
}

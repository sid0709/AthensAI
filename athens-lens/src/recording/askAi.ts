import { ATHENS_API_BASE_URL, AthensApiError } from "../api/athensApi";
import type { Session } from "../types";

export interface FormAnswer {
  id: string;
  question: string;
  answer: string;
  confidence?: "high" | "medium" | "low";
}

export interface PageContext {
  url: string;
  title: string;
  metaDescription?: string;
  visibleText: string;
  /** Compact actionable field list (source of truth for fillable controls). */
  formTree?: string;
  forms?: Array<{
    label?: string;
    name?: string;
    type?: string;
    placeholder?: string;
    required?: boolean;
    options?: string[];
  }>;
  readMeta?: {
    tabId?: number;
    frameCount?: number;
    selectedFrameCount?: number;
    charCount?: number;
    formCount?: number;
    formTreeChars?: number;
    oakFrameCount?: number;
    oakNodeCount?: number;
    oakFieldCount?: number;
    truncated?: boolean;
    note?: string;
  };
}

type ReadPageResponse =
  | { ok: true; tabId: number; pageContext: PageContext }
  | { ok: false; error?: string };

function mapAnswers(
  entries: Array<{ question?: string; suggestedAnswer?: string; confidence?: FormAnswer["confidence"] }> | undefined,
): FormAnswer[] {
  return (entries || [])
    .map((entry, index) => ({
      id: `answer-${index + 1}`,
      question: String(entry.question || "").trim(),
      answer: String(entry.suggestedAnswer || "").trim(),
      confidence: entry.confidence,
    }))
    .filter((entry) => entry.question && entry.answer);
}

export async function readOpenPageText(tabId?: number | null): Promise<{ tabId: number; pageContext: PageContext }> {
  const api = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome;
  if (!api?.runtime?.sendMessage) {
    throw new Error("Ask AI is only available in the Athens Lens Chrome extension.");
  }
  const response = await api.runtime.sendMessage({
    type: "ATHENS_LENS_READ_PAGE_TEXT",
    tabId: tabId ?? null,
  }) as ReadPageResponse;
  if (!response?.ok) {
    throw new Error(response?.error || "Could not read the open application page.");
  }
  return { tabId: response.tabId, pageContext: response.pageContext };
}

export type AskAiStreamHandlers = {
  onToken?(text: string): void;
  onAnswers?(answers: FormAnswer[]): void;
  signal?: AbortSignal;
};

/**
 * Stream Ask AI for fast first-token UX. Schema may be imperfect mid-stream;
 * answers are best-effort extracted as tokens arrive.
 */
export async function askAiForPageAnswersStream(
  session: Session,
  pageContext: PageContext,
  job: { id?: string; title?: string } | null | undefined,
  handlers: AskAiStreamHandlers = {},
): Promise<{ answers: FormAnswer[]; summary: string; mode: string; streamText: string }> {
  let response: Response;
  try {
    response = await fetch(`${ATHENS_API_BASE_URL}/athens-lens/ask-ai`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        stream: true,
        pageContext,
        jobId: job?.id || undefined,
        jobTitle: job?.title || undefined,
      }),
      signal: handlers.signal,
    });
  } catch {
    throw new AthensApiError("Athens server could not be reached.", 0, "NETWORK_ERROR");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: string; code?: string } | null;
    throw new AthensApiError(
      payload?.message || payload?.error || "Athens server returned an error.",
      response.status,
      payload?.code,
    );
  }

  if (!response.body) {
    throw new AthensApiError("Athens server returned an empty stream.", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamText = "";
  let summary = "";
  let mode = "llm-stream";
  let answers: FormAnswer[] = [];

  const handleEvent = (eventName: string, dataRaw: string) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (eventName === "token") {
      const text = String(data.text || "");
      if (!text) return;
      streamText += text;
      handlers.onToken?.(text);
      return;
    }
    if (eventName === "answers") {
      answers = mapAnswers(data.answers as Array<{ question?: string; suggestedAnswer?: string }>);
      handlers.onAnswers?.(answers);
      return;
    }
    if (eventName === "done") {
      summary = String(data.summary || "");
      mode = String(data.mode || mode);
      answers = mapAnswers(data.answers as Array<{ question?: string; suggestedAnswer?: string }>);
      handlers.onAnswers?.(answers);
      return;
    }
    if (eventName === "error") {
      throw new AthensApiError(
        String(data.message || "Ask AI stream failed."),
        Number(data.status) || 500,
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) handleEvent(eventName, dataLines.join("\n"));
    }
  }

  return { answers, summary, mode, streamText };
}

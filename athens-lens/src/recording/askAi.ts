import { requestAthensApi } from "../api/athensApi";
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
}

type ReadPageResponse =
  | { ok: true; tabId: number; pageContext: PageContext }
  | { ok: false; error?: string };

type AskAiResponse = {
  success: boolean;
  answers: Array<{
    question: string;
    suggestedAnswer: string;
    confidence?: "high" | "medium" | "low";
  }>;
  summary?: string;
  mode?: string;
  message?: string;
};

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

export async function askAiForPageAnswers(
  session: Session,
  pageContext: PageContext,
  job?: { id?: string; title?: string; description?: string } | null,
): Promise<{ answers: FormAnswer[]; summary: string; mode: string }> {
  const payload = await requestAthensApi<AskAiResponse>("/athens-lens/ask-ai", {
    method: "POST",
    accessToken: session.accessToken,
    body: JSON.stringify({
      pageContext,
      jobId: job?.id || undefined,
      sessionContext: {
        jdSummary: job?.title || undefined,
        jdText: job?.description || undefined,
      },
    }),
  });

  const answers = (payload.answers || []).map((entry, index) => ({
    id: `answer-${index + 1}`,
    question: entry.question,
    answer: entry.suggestedAnswer,
    confidence: entry.confidence,
  }));

  return {
    answers,
    summary: payload.summary || "",
    mode: payload.mode || "llm",
  };
}

import { requestAthensApi } from "../api/athensApi";
import type { Session } from "../types";
import type { FormAnswer, PageContext } from "./askAi";

export type BidPersistAnswers = Array<Pick<FormAnswer, "question" | "answer" | "confidence"> & {
  suggestedAnswer?: string;
}>;

function extensionApi() {
  const root = globalThis as typeof globalThis & {
    chrome?: typeof chrome;
    browser?: typeof chrome;
  };
  return root.chrome ?? root.browser ?? null;
}

type DigestResponse =
  | { ok: true; mimeType: string; byteLength: number; filename: string }
  | { ok: false; error?: string };

type PutResponse = { ok: true } | { ok: false; error?: string };

async function recordingDigest(sessionId: string) {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) {
    throw new Error("Recording upload is only available in the Athens Lens Chrome extension.");
  }
  const response = await api.runtime.sendMessage({
    type: "ATHENS_LENS_RECORDING_DIGEST",
    sessionId,
  }) as DigestResponse | undefined;
  if (!response?.ok) {
    throw new Error((!response?.ok && response?.error) || "Recording blob missing.");
  }
  return response;
}

async function putRecording(sessionId: string, uploadUrl: string) {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) {
    throw new Error("Recording upload is only available in the Athens Lens Chrome extension.");
  }
  const response = await api.runtime.sendMessage({
    type: "ATHENS_LENS_PUT_RECORDING",
    sessionId,
    uploadUrl,
  }) as PutResponse | undefined;
  if (!response?.ok) {
    throw new Error((!response?.ok && response?.error) || "Could not upload the recording.");
  }
}

async function discardRecording(sessionId: string) {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) return;
  try {
    await api.runtime.sendMessage({ type: "ATHENS_LENS_DISCARD_RECORDING", sessionId });
  } catch {
    // best-effort
  }
}

export async function startAthensLensBid(
  session: Session,
  input: { jobId: string; sessionId: string; applyUrl?: string | null },
) {
  return requestAthensApi("/athens-lens/bids/start", {
    method: "POST",
    accessToken: session.accessToken,
    body: JSON.stringify({
      jobId: input.jobId,
      sessionId: input.sessionId,
      applyUrl: input.applyUrl || undefined,
      bidderName: session.displayName || session.username,
    }),
  });
}

export async function saveAthensLensAnalysis(
  session: Session,
  input: {
    jobId: string;
    answers: BidPersistAnswers;
    summary?: string;
    pageContext?: PageContext | null;
    mode?: string;
  },
) {
  return requestAthensApi("/athens-lens/bids/analysis", {
    method: "POST",
    accessToken: session.accessToken,
    body: JSON.stringify({
      jobId: input.jobId,
      summary: input.summary || "",
      answers: input.answers.map((entry) => ({
        question: entry.question,
        suggestedAnswer: entry.suggestedAnswer || entry.answer,
        confidence: entry.confidence,
      })),
      pageUrl: input.pageContext?.url || "",
      pageTitle: input.pageContext?.title || "",
      mode: input.mode || "llm",
    }),
  });
}

export async function skipAthensLensBid(session: Session, jobId: string) {
  return requestAthensApi("/athens-lens/bids/skip", {
    method: "POST",
    accessToken: session.accessToken,
    body: JSON.stringify({
      jobId,
      bidderName: session.displayName || session.username,
    }),
  });
}

export async function completeAthensLensBidWithoutVideo(session: Session, jobId: string) {
  return requestAthensApi("/athens-lens/bids/complete", {
    method: "POST",
    accessToken: session.accessToken,
    body: JSON.stringify({
      jobId,
      bidderName: session.displayName || session.username,
    }),
  });
}

export async function uploadAthensLensRecording(
  session: Session,
  input: {
    jobId: string;
    recordingSessionId: string;
    applyUrl?: string | null;
    durationSec?: number | null;
    recordedStartAt?: string | null;
    recordedEndAt?: string | null;
    markCompleted: boolean;
  },
) {
  const digest = await recordingDigest(input.recordingSessionId);
  const started = await requestAthensApi<{
    success: boolean;
    uploadId: string;
    uploadUrl: string;
  }>("/athens-lens/bids/recordings/uploads", {
    method: "POST",
    accessToken: session.accessToken,
    body: JSON.stringify({
      jobId: input.jobId,
      sessionId: input.recordingSessionId,
      applyUrl: input.applyUrl || undefined,
      bidderName: session.displayName || session.username,
      contentType: digest.mimeType || "video/webm",
      fileName: digest.filename,
      byteCount: digest.byteLength,
    }),
  });

  await putRecording(input.recordingSessionId, started.uploadUrl);

  const completed = await requestAthensApi(
    `/athens-lens/bids/recordings/uploads/${encodeURIComponent(started.uploadId)}/complete`,
    {
      method: "POST",
      accessToken: session.accessToken,
      body: JSON.stringify({
        applyUrl: input.applyUrl || undefined,
        bidderName: session.displayName || session.username,
        durationSec: input.durationSec ?? undefined,
        recordedStartAt: input.recordedStartAt ?? undefined,
        recordedEndAt: input.recordedEndAt ?? undefined,
        markCompleted: input.markCompleted,
      }),
    },
  );
  await discardRecording(input.recordingSessionId);
  return completed;
}

export async function finishAthensLensBid(input: {
  session: Session;
  jobId: string;
  applyUrl?: string | null;
  recordingSessionId: string | null;
  durationSec?: number | null;
  recordedStartAt?: string | null;
  recordedEndAt?: string | null;
  submitted: boolean;
  answers?: BidPersistAnswers;
  summary?: string;
  pageContext?: PageContext | null;
  mode?: string;
}) {
  const { session, jobId, submitted } = input;

  if (input.answers?.length) {
    try {
      await saveAthensLensAnalysis(session, {
        jobId,
        answers: input.answers,
        summary: input.summary,
        pageContext: input.pageContext,
        mode: input.mode,
      });
    } catch (error) {
      console.warn("Athens Lens: could not persist Ask AI answers", error);
    }
  }

  if (!submitted) {
    if (input.recordingSessionId) await discardRecording(input.recordingSessionId);
    await skipAthensLensBid(session, jobId);
    return { outcome: "skipped" as const };
  }

  if (input.recordingSessionId) {
    try {
      await uploadAthensLensRecording(session, {
        jobId,
        recordingSessionId: input.recordingSessionId,
        applyUrl: input.applyUrl,
        durationSec: input.durationSec,
        recordedStartAt: input.recordedStartAt,
        recordedEndAt: input.recordedEndAt,
        markCompleted: true,
      });
      return { outcome: "submitted" as const, uploaded: true };
    } catch (error) {
      console.warn("Athens Lens: recording upload failed, completing without video", error);
      await completeAthensLensBidWithoutVideo(session, jobId);
      if (input.recordingSessionId) await discardRecording(input.recordingSessionId);
      return {
        outcome: "submitted" as const,
        uploaded: false,
        uploadError: error instanceof Error ? error.message : "Recording upload failed.",
      };
    }
  }

  await completeAthensLensBidWithoutVideo(session, jobId);
  return { outcome: "submitted" as const, uploaded: false };
}

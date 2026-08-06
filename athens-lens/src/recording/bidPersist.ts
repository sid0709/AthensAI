import { requestAthensApi } from "../api/athensApi";
import type { Session } from "../types";
import type { FormAnswer, PageContext } from "./askAi";

export type BidPersistAnswers = Array<Pick<FormAnswer, "question" | "answer" | "confidence"> & {
  suggestedAnswer?: string;
}>;

export type RecordingUploadPart = {
  recordingSessionId: string;
  durationSec?: number | null;
  recordedStartAt?: string | null;
  recordedEndAt?: string | null;
};

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
      contentType: digest.mimeType || "video/mp4",
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
  /** @deprecated Prefer recordingSessions for multi-tab uploads. */
  recordingSessionId?: string | null;
  recordingSessions?: RecordingUploadPart[];
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

  const parts: RecordingUploadPart[] = Array.isArray(input.recordingSessions)
    && input.recordingSessions.length > 0
    ? input.recordingSessions.filter((part) => part.recordingSessionId)
    : input.recordingSessionId
      ? [{
          recordingSessionId: input.recordingSessionId,
          durationSec: input.durationSec,
          recordedStartAt: input.recordedStartAt,
          recordedEndAt: input.recordedEndAt,
        }]
      : [];

  // "No, not submitted" — throw away local clips only. No Athens API / DB writes.
  if (!submitted) {
    for (const part of parts) {
      await discardRecording(part.recordingSessionId);
    }
    return { outcome: "abandoned" as const, uploadedCount: 0 };
  }

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

  if (parts.length > 0) {
    let uploadedCount = 0;
    let lastError: string | null = null;
    let markedComplete = false;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const isLast = index === parts.length - 1;
      try {
        await uploadAthensLensRecording(session, {
          jobId,
          recordingSessionId: part.recordingSessionId,
          applyUrl: input.applyUrl,
          durationSec: part.durationSec,
          recordedStartAt: part.recordedStartAt,
          recordedEndAt: part.recordedEndAt,
          // Mark the bid submitted only after the final clip lands.
          markCompleted: isLast,
        });
        uploadedCount += 1;
        if (isLast) markedComplete = true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Recording upload failed.";
        console.warn("Athens Lens: recording upload failed", part.recordingSessionId, error);
        await discardRecording(part.recordingSessionId);
      }
    }

    if (uploadedCount === 0) {
      await completeAthensLensBidWithoutVideo(session, jobId);
      return {
        outcome: "submitted" as const,
        uploaded: false,
        uploadedCount: 0,
        uploadError: lastError || "Recording upload failed.",
      };
    }

    if (!markedComplete) {
      await completeAthensLensBidWithoutVideo(session, jobId);
    }

    return {
      outcome: "submitted" as const,
      uploaded: true,
      uploadedCount,
      uploadError: uploadedCount < parts.length
        ? (lastError || `Uploaded ${uploadedCount} of ${parts.length} recordings.`)
        : null,
    };
  }

  await completeAthensLensBidWithoutVideo(session, jobId);
  return { outcome: "submitted" as const, uploaded: false, uploadedCount: 0 };
}

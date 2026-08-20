import { deleteRecordingBlob, getRecordingBlob, putRecordingBlob } from "./recordingBlobStore";
import {
  pickRecordingMimeType,
  recordingFileExtension,
  RECORDING_VIDEO_BITS_PER_SECOND,
} from "./recordingCapture";

export const EMPTY_RECORDING_ERROR =
  "Recording captured no video. Stay on the application tab and try Record again.";

type LocalRecorder = {
  mediaRecorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
};

export type SidePanelStopResult =
  | { ok: true; filename: string; mimeType: string; byteLength: number }
  | { ok: false; error: string };

const recorders = new Map<string, LocalRecorder>();

function recordingFilename(mimeType: string) {
  return `athens-lens-recording-${Date.now()}.${recordingFileExtension(mimeType)}`;
}

async function persistChunks(sessionId: string, recorder: LocalRecorder) {
  if (!recorder.chunks.length) return;
  const blob = new Blob(recorder.chunks, { type: recorder.mimeType });
  if (!blob.size) return;
  await putRecordingBlob({
    sessionId,
    blob,
    mimeType: recorder.mimeType,
    filename: recordingFilename(recorder.mimeType),
    byteLength: blob.size,
  });
}

export function startSidePanelRecording(sessionId: string, stream: MediaStream): void {
  const existing = recorders.get(sessionId);
  if (existing) {
    try {
      if (existing.mediaRecorder.state !== "inactive") existing.mediaRecorder.stop();
    } catch {
      // Replace the previous recorder for this session.
    }
    recorders.delete(sessionId);
  }

  if (typeof MediaRecorder === "undefined") return;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;

  const chunks: Blob[] = [];
  const mimeType = pickRecordingMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
  });
  mediaRecorder.ondataavailable = (event) => {
    if (!event.data?.size) return;
    chunks.push(event.data);
    void persistChunks(sessionId, { mediaRecorder, chunks, mimeType });
  };
  mediaRecorder.start(2000);
  recorders.set(sessionId, { mediaRecorder, chunks, mimeType });
}

export async function stopSidePanelRecording(sessionId: string): Promise<SidePanelStopResult> {
  const recorder = recorders.get(sessionId);
  if (!recorder) {
    const stored = await getRecordingBlob(sessionId);
    if (stored?.byteLength) {
      return {
        ok: true,
        filename: stored.filename,
        mimeType: stored.mimeType,
        byteLength: stored.byteLength,
      };
    }
    return { ok: false, error: "No active recording found." };
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    recorder.mediaRecorder.onstop = () => {
      resolve(new Blob(recorder.chunks, { type: recorder.mimeType }));
    };
    recorder.mediaRecorder.onerror = () => reject(new Error("Recording failed."));
    try {
      if (recorder.mediaRecorder.state !== "inactive") recorder.mediaRecorder.stop();
      else resolve(new Blob(recorder.chunks, { type: recorder.mimeType }));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Could not stop recording."));
    }
  });

  recorders.delete(sessionId);

  if (!blob.size) {
    return { ok: false, error: EMPTY_RECORDING_ERROR };
  }

  const filename = recordingFilename(recorder.mimeType);
  await putRecordingBlob({
    sessionId,
    blob,
    mimeType: recorder.mimeType,
    filename,
    byteLength: blob.size,
  });
  return {
    ok: true,
    filename,
    mimeType: recorder.mimeType,
    byteLength: blob.size,
  };
}

export async function discardSidePanelRecording(sessionId: string): Promise<void> {
  const recorder = recorders.get(sessionId);
  if (recorder) {
    try {
      if (recorder.mediaRecorder.state !== "inactive") recorder.mediaRecorder.stop();
    } catch {
      // Best-effort.
    }
    recorders.delete(sessionId);
  }
  await deleteRecordingBlob(sessionId);
}

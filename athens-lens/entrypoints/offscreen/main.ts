type StartMessage = {
  type: "OFFSCREEN_START_RECORDING";
  sessionId: string;
  streamId: string;
};

type StopMessage = {
  type: "OFFSCREEN_STOP_RECORDING";
  sessionId: string;
  filename?: string;
};

type DigestMessage = {
  type: "OFFSCREEN_RECORDING_DIGEST";
  sessionId: string;
};

type PutMessage = {
  type: "OFFSCREEN_PUT_RECORDING";
  sessionId: string;
  uploadUrl: string;
};

type DiscardMessage = {
  type: "OFFSCREEN_DISCARD_RECORDING";
  sessionId: string;
};

type RecorderState = {
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  mimeType: string;
};

type PendingRecording = {
  blob: Blob;
  mimeType: string;
  filename: string;
};

const recorders = new Map<string, RecorderState>();
const pendingRecordings = new Map<string, PendingRecording>();

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

async function getTabStream(streamId: string): Promise<MediaStream> {
  // Chrome tab capture requires the legacy mandatory constraint shape.
  // Keep resolution/fps low — recordings are for review, not archival quality.
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome tab-capture constraints are not in the DOM typings.
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth: 640,
        maxHeight: 360,
        maxFrameRate: 6,
      },
    },
  });
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function putResumable(uploadUrl: string, blob: Blob) {
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(offset + chunkSize, blob.size);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - offset),
        "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}`,
      },
      body: blob.slice(offset, end),
    });
    if (response.status !== 308 && !response.ok) {
      throw new Error(`Storage upload failed (${response.status})`);
    }
    offset = end;
  }
}

async function startRecording(sessionId: string, streamId: string) {
  if (recorders.has(sessionId)) {
    throw new Error("A recording is already active for this session.");
  }
  pendingRecordings.delete(sessionId);
  const stream = await getTabStream(streamId);
  const chunks: Blob[] = [];
  const mimeType = pickMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 180_000,
  });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  mediaRecorder.start(2000);
  recorders.set(sessionId, { mediaRecorder, stream, chunks, mimeType });
}

async function stopRecording(sessionId: string, filename?: string) {
  const recorder = recorders.get(sessionId);
  if (!recorder) throw new Error("No active recording found.");

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

  stopStream(recorder.stream);
  recorders.delete(sessionId);

  const extension = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
  const downloadName = filename || `athens-lens-recording-${Date.now()}.${extension}`;
  pendingRecordings.set(sessionId, {
    blob,
    mimeType: recorder.mimeType,
    filename: downloadName,
  });

  // Quiet local backup — Bid Management plays the uploaded Storage copy.
  const objectUrl = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: downloadName,
      saveAs: false,
    });
  } catch {
    // Upload path still works if the download permission/path fails.
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  return {
    mimeType: recorder.mimeType,
    byteLength: blob.size,
    filename: downloadName,
  };
}

async function recordingDigest(sessionId: string) {
  const pending = pendingRecordings.get(sessionId);
  if (!pending?.blob?.size) throw new Error("No pending recording found.");
  return {
    mimeType: pending.mimeType,
    byteLength: pending.blob.size,
    filename: pending.filename,
  };
}

async function putRecording(sessionId: string, uploadUrl: string) {
  const pending = pendingRecordings.get(sessionId);
  if (!pending?.blob?.size) throw new Error("No pending recording found.");
  await putResumable(uploadUrl, pending.blob);
}

function discardRecording(sessionId: string) {
  pendingRecordings.delete(sessionId);
}

chrome.runtime.onMessage.addListener((
  message: StartMessage | StopMessage | DigestMessage | PutMessage | DiscardMessage,
  _sender: unknown,
  sendResponse: (response?: unknown) => void,
) => {
  if (message?.type === "OFFSCREEN_START_RECORDING") {
    void startRecording(message.sessionId, message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not start recording.",
        });
      });
    return true;
  }

  if (message?.type === "OFFSCREEN_STOP_RECORDING") {
    void stopRecording(message.sessionId, message.filename)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not stop recording.",
        });
      });
    return true;
  }

  if (message?.type === "OFFSCREEN_RECORDING_DIGEST") {
    void recordingDigest(message.sessionId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not read recording.",
        });
      });
    return true;
  }

  if (message?.type === "OFFSCREEN_PUT_RECORDING") {
    void putRecording(message.sessionId, message.uploadUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not upload recording.",
        });
      });
    return true;
  }

  if (message?.type === "OFFSCREEN_DISCARD_RECORDING") {
    discardRecording(message.sessionId);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

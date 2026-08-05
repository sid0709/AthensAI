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

type RecorderState = {
  mediaRecorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  mimeType: string;
};

const recorders = new Map<string, RecorderState>();

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
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome tab-capture constraints are not in the DOM typings.
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 15,
      },
    },
  });
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function startRecording(sessionId: string, streamId: string) {
  if (recorders.has(sessionId)) {
    throw new Error("A recording is already active for this session.");
  }
  const stream = await getTabStream(streamId);
  const chunks: Blob[] = [];
  const mimeType = pickMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 900_000,
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
  const objectUrl = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: downloadName,
      saveAs: true,
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  return {
    mimeType: recorder.mimeType,
    byteLength: blob.size,
    filename: downloadName,
  };
}

chrome.runtime.onMessage.addListener((
  message: StartMessage | StopMessage,
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

  return false;
});

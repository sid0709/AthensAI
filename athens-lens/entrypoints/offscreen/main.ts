type StartMessage = {
  type: "OFFSCREEN_START_RECORDING";
  sessionId: string;
  streamId: string;
  captureSource?: "tab" | "desktop";
};

type RelayStartMessage = {
  type: "OFFSCREEN_START_RELAY_RECORDING";
  sessionId: string;
  offer: RTCSessionDescriptionInit;
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
const relayPeers = new Map<string, RTCPeerConnection>();

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

async function getCaptureStream(
  streamId: string,
  captureSource: "tab" | "desktop",
): Promise<MediaStream> {
  // Chrome capture stream IDs require the legacy mandatory constraint shape.
  // Keep resolution/fps low — recordings are for review, not archival quality.
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome tab-capture constraints are not in the DOM typings.
      mandatory: {
        chromeMediaSource: captureSource,
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

async function startRecording(
  sessionId: string,
  streamId: string,
  captureSource: "tab" | "desktop" = "tab",
) {
  const stream = await getCaptureStream(streamId, captureSource);
  startRecordingFromStream(sessionId, stream);
}

function startRecordingFromStream(sessionId: string, stream: MediaStream) {
  if (recorders.has(sessionId)) {
    throw new Error("A recording is already active for this session.");
  }
  pendingRecordings.delete(sessionId);
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

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(finish, 2_000);
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }
    function onStateChange() {
      if (peer.iceGatheringState === "complete") finish();
    }
    peer.addEventListener("icegatheringstatechange", onStateChange);
  });
}

async function startRelayRecording(
  sessionId: string,
  offer: RTCSessionDescriptionInit,
): Promise<RTCSessionDescriptionInit> {
  if (recorders.has(sessionId) || relayPeers.has(sessionId)) {
    throw new Error("A recording is already active for this session.");
  }

  const peer = new RTCPeerConnection({ iceServers: [] });
  const stream = new MediaStream();
  peer.ontrack = (event) => {
    if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
  };

  try {
    await peer.setRemoteDescription(offer);
    for (const receiver of peer.getReceivers()) {
      if (receiver.track && !stream.getTracks().includes(receiver.track)) {
        stream.addTrack(receiver.track);
      }
    }
    if (!stream.getVideoTracks().length) {
      throw new Error("The selected tab did not provide a video track.");
    }

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await waitForIceGathering(peer);
    startRecordingFromStream(sessionId, stream);
    relayPeers.set(sessionId, peer);

    const description = peer.localDescription;
    if (!description) throw new Error("Could not connect the selected tab to the recorder.");
    return { type: description.type, sdp: description.sdp };
  } catch (error) {
    stopStream(stream);
    peer.close();
    throw error;
  }
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
  relayPeers.get(sessionId)?.close();
  relayPeers.delete(sessionId);

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
  relayPeers.get(sessionId)?.close();
  relayPeers.delete(sessionId);
}

chrome.runtime.onMessage.addListener((
  message: StartMessage | RelayStartMessage | StopMessage | DigestMessage | PutMessage | DiscardMessage,
  _sender: unknown,
  sendResponse: (response?: unknown) => void,
) => {
  if (message?.type === "OFFSCREEN_START_RECORDING") {
    void startRecording(message.sessionId, message.streamId, message.captureSource)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not start recording.",
        });
      });
    return true;
  }

  if (message?.type === "OFFSCREEN_START_RELAY_RECORDING") {
    void startRelayRecording(message.sessionId, message.offer)
      .then((answer) => sendResponse({ ok: true, answer }))
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

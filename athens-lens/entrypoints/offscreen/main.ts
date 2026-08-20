import {
  deleteRecordingBlob,
  getRecordingBlob,
  putRecordingBlob,
} from "../../src/recording/recordingBlobStore";
import {
  pickRecordingMimeType,
  recordingCaptureMandatory,
  recordingFileExtension,
  RECORDING_VIDEO_BITS_PER_SECOND,
  fitRecordingFrame,
} from "../../src/recording/recordingCapture";
import { putResumable } from "../../src/recording/recordingUpload";
import { EMPTY_RECORDING_ERROR } from "../../src/recording/sidePanelRecorder";

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

type PingMessage = {
  type: "OFFSCREEN_PING";
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

async function getCaptureStream(
  streamId: string,
  captureSource: "tab" | "desktop",
): Promise<MediaStream> {
  // Chrome capture stream IDs require the legacy mandatory constraint shape.
  // maxWidth/maxHeight cap at 1024×768; Chrome preserves aspect ratio inside that box.
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome tab-capture constraints are not in the DOM typings.
      mandatory: recordingCaptureMandatory(captureSource, streamId),
    },
  });
}

/** If the track is larger than our cap, ask for a downscale (ratio preserved). */
async function clampTrackToRecordingFrame(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const settings = track.getSettings?.() || {};
  const width = Number(settings.width) || 0;
  const height = Number(settings.height) || 0;
  if (width <= 0 || height <= 0) return;
  const fitted = fitRecordingFrame(width, height);
  if (fitted.width === width && fitted.height === height) return;
  try {
    await track.applyConstraints({
      width: { ideal: fitted.width, max: fitted.width },
      height: { ideal: fitted.height, max: fitted.height },
      frameRate: { ideal: 15, max: 15 },
    });
  } catch {
    // Some chromeMediaSource tracks reject applyConstraints — capture max* still applies.
  }
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function startRecording(
  sessionId: string,
  streamId: string,
  captureSource: "tab" | "desktop" = "tab",
) {
  const stream = await getCaptureStream(streamId, captureSource);
  await clampTrackToRecordingFrame(stream);
  startRecordingFromStream(sessionId, stream);
}

function startRecordingFromStream(sessionId: string, stream: MediaStream) {
  if (recorders.has(sessionId)) {
    throw new Error("A recording is already active for this session.");
  }
  pendingRecordings.delete(sessionId);
  const chunks: Blob[] = [];
  const mimeType = pickRecordingMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
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

    await clampTrackToRecordingFrame(stream);
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

  if (!blob.size) {
    throw new Error(EMPTY_RECORDING_ERROR);
  }

  const extension = recordingFileExtension(recorder.mimeType);
  const downloadName = filename || `athens-lens-recording-${Date.now()}.${extension}`;
  pendingRecordings.set(sessionId, {
    blob,
    mimeType: recorder.mimeType,
    filename: downloadName,
  });
  await putRecordingBlob({
    sessionId,
    blob,
    mimeType: recorder.mimeType,
    filename: downloadName,
    byteLength: blob.size,
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
  const pending = pendingRecordings.get(sessionId) ?? await getRecordingBlob(sessionId);
  if (!pending?.blob?.size) throw new Error("No pending recording found.");
  return {
    mimeType: pending.mimeType,
    byteLength: pending.blob.size,
    filename: pending.filename,
  };
}

async function putRecording(sessionId: string, uploadUrl: string) {
  const pending = pendingRecordings.get(sessionId) ?? await getRecordingBlob(sessionId);
  if (!pending?.blob?.size) throw new Error("No pending recording found.");
  await putResumable(uploadUrl, pending.blob);
}

function discardRecording(sessionId: string) {
  pendingRecordings.delete(sessionId);
  relayPeers.get(sessionId)?.close();
  relayPeers.delete(sessionId);
  void deleteRecordingBlob(sessionId);
}

chrome.runtime.onMessage.addListener((
  message: StartMessage | RelayStartMessage | StopMessage | DigestMessage | PutMessage | DiscardMessage | PingMessage,
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

  if (message?.type === "OFFSCREEN_PING") {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

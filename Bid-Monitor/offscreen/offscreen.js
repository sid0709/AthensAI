const recorders = new Map();

const RECORDING_CONFIG = {
  videoBitsPerSecond: 900_000,
  maxWidth: 1280,
  maxHeight: 720,
  maxFrameRate: 15,
  timesliceMs: 2000,
};

let preferredVideoFormat = 'webm';

function setPreferredVideoFormat(videoFormat) {
  preferredVideoFormat = VideoFormat.normalizePreference(videoFormat);
}

function pickMimeType() {
  return VideoFormat.pickMimeType(preferredVideoFormat);
}

async function getTabStream(streamId) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: RECORDING_CONFIG.maxWidth,
        maxHeight: RECORDING_CONFIG.maxHeight,
        maxFrameRate: RECORDING_CONFIG.maxFrameRate,
      },
    },
  });
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function getRecorder(sessionId) {
  const recorder = recorders.get(sessionId);
  if (!recorder) throw new Error(`Recorder not found for session ${sessionId}.`);
  return recorder;
}

function attachRecorder(sessionId, stream, chunks, picked) {
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: picked.mimeType,
    videoBitsPerSecond: RECORDING_CONFIG.videoBitsPerSecond,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  mediaRecorder.start(RECORDING_CONFIG.timesliceMs);

  recorders.set(sessionId, {
    mediaRecorder,
    chunks,
    stream,
    mimeType: picked.mimeType,
    videoFormat: picked.format,
  });

  return recorders.get(sessionId);
}

async function waitForRecorderStop(mediaRecorder) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  await new Promise((resolve) => {
    mediaRecorder.addEventListener('stop', resolve, { once: true });
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.requestData();
    }
    mediaRecorder.stop();
  });
}

async function getTabCaptureStreamId(tabId, maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(streamId);
        });
      });
    } catch (err) {
      const message = String(err?.message || err);
      const retriable =
        message.includes('has not been invoked') ||
        message.includes('Cannot capture') ||
        message.includes('Chrome pages cannot be captured');

      if (!retriable || attempt === maxAttempts - 1) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error('Failed to obtain tab capture stream.');
}

async function startRecording(sessionId, tabId, streamId, videoFormat, startPaused = false) {
  if (recorders.has(sessionId)) {
    throw new Error(`Recording already exists for session ${sessionId}.`);
  }

  if (!streamId) {
    throw new Error('Missing capture stream id from service worker.');
  }

  setPreferredVideoFormat(videoFormat);
  const picked = pickMimeType();
  const stream = await getTabStream(streamId);
  const chunks = [];
  const recorder = attachRecorder(sessionId, stream, chunks, picked);

  if (startPaused && recorder.mediaRecorder.state === 'recording') {
    recorder.mediaRecorder.pause();
  }

  return {
    mimeType: picked.mimeType,
    videoFormat: picked.format,
    fallbackUsed: picked.fallbackUsed,
    startedPaused: startPaused,
  };
}

async function pauseRecording(sessionId) {
  const recorder = recorders.get(sessionId);
  if (!recorder) {
    return { ok: true, skipped: true };
  }
  if (recorder.mediaRecorder.state === 'recording') {
    recorder.mediaRecorder.pause();
  }
  return { ok: true };
}

async function resumeRecording(sessionId) {
  const recorder = recorders.get(sessionId);
  if (!recorder) {
    return { ok: true, skipped: true };
  }
  if (recorder.mediaRecorder.state === 'paused') {
    recorder.mediaRecorder.resume();
  }
  return { ok: true };
}

async function reconnectRecording(sessionId, streamId, videoFormat) {
  const recorder = recorders.get(sessionId);
  if (!recorder) {
    return { ok: true, skipped: true };
  }
  if (!streamId) {
    throw new Error('Missing capture stream id for reconnect.');
  }

  setPreferredVideoFormat(videoFormat);

  if (recorder.mediaRecorder.state === 'recording') {
    recorder.mediaRecorder.requestData();
    recorder.mediaRecorder.pause();
  }

  if (recorder.mediaRecorder.state === 'paused') {
    await waitForRecorderStop(recorder.mediaRecorder);
  }

  stopStream(recorder.stream);
  recorder.stream = await getTabStream(streamId);
  const picked = pickMimeType();
  attachRecorder(sessionId, recorder.stream, recorder.chunks, picked);

  return {
    mimeType: picked.mimeType,
    videoFormat: picked.format,
  };
}

async function stopRecording(sessionId) {
  const recorder = recorders.get(sessionId);
  if (!recorder) {
    return { mimeType: 'video/webm', videoFormat: 'webm', size: 0 };
  }

  if (recorder.mediaRecorder.state === 'paused') {
    recorder.mediaRecorder.resume();
  }

  await waitForRecorderStop(recorder.mediaRecorder);
  stopStream(recorder.stream);
  recorders.delete(sessionId);

  const blob = new Blob(recorder.chunks, { type: recorder.mimeType });

  if (sessionId && blob.size > 0) {
    await SessionVideoStore.save(sessionId, blob, {
      mimeType: recorder.mimeType,
      videoFormat: recorder.videoFormat,
    });
  }

  return {
    mimeType: recorder.mimeType,
    videoFormat: recorder.videoFormat,
    size: blob.size,
  };
}

async function getVideoBuffer(sessionId) {
  const entry = await SessionVideoStore.get(sessionId);
  if (!entry?.blob) throw new Error('Session video not found.');

  return {
    mimeType: entry.mimeType ?? entry.blob.type ?? 'video/webm',
    videoFormat: entry.videoFormat ?? VideoFormat.extensionForMimeType(entry.mimeType),
    videoBuffer: await entry.blob.arrayBuffer(),
  };
}

function waitForVideoEvent(video, eventName, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video ${eventName}.`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('A recording clip could not be decoded.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
    };
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function drawClipToCanvas(video, context, canvas) {
  const width = Number(video.videoWidth) || RECORDING_CONFIG.maxWidth;
  const height = Number(video.videoHeight) || RECORDING_CONFIG.maxHeight;
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const drawWidth = Math.round(width * scale);
  const drawHeight = Math.round(height * scale);
  const x = Math.round((canvas.width - drawWidth) / 2);
  const y = Math.round((canvas.height - drawHeight) / 2);

  const draw = () => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, x, y, drawWidth, drawHeight);
  };

  draw();
  await video.play();
  const timeoutMs = Number.isFinite(video.duration)
    ? Math.max(15000, Math.ceil(video.duration * 1000) + 10000)
    : 10 * 60 * 1000;

  await new Promise((resolve, reject) => {
    const interval = setInterval(draw, Math.round(1000 / RECORDING_CONFIG.maxFrameRate));
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('A recording clip took too long to process.'));
    }, timeoutMs);
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
    const onEnded = () => {
      draw();
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('A recording clip stopped during processing.'));
    };
    video.addEventListener('ended', onEnded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

/**
 * Re-encode independent MediaRecorder files through one canvas MediaRecorder.
 * Raw byte concatenation is invalid because each clip has its own container
 * header. This produces one playable WebM with a single timeline.
 */
async function stitchRecordingSegments(segmentIds, outputKey) {
  const sourceEntries = [];
  for (const segmentId of segmentIds || []) {
    const entry = await SessionVideoStore.getSegment(segmentId);
    if (entry?.blob?.size) sourceEntries.push({ segmentId, ...entry });
  }
  if (!sourceEntries.length) {
    return {
      storageKey: null,
      mimeType: 'video/webm',
      videoFormat: 'webm',
      size: 0,
      segmentIds: [],
    };
  }
  if (sourceEntries.length === 1) {
    return {
      storageKey: sourceEntries[0].segmentId,
      mimeType: sourceEntries[0].mimeType || sourceEntries[0].blob.type || 'video/webm',
      videoFormat: sourceEntries[0].videoFormat || 'webm',
      size: sourceEntries[0].blob.size,
      segmentIds: [sourceEntries[0].segmentId],
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = RECORDING_CONFIG.maxWidth;
  canvas.height = RECORDING_CONFIG.maxHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create the final video canvas.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const outputStream = canvas.captureStream(RECORDING_CONFIG.maxFrameRate);
  const picked = VideoFormat.pickMimeType('webm');
  const chunks = [];
  const mediaRecorder = new MediaRecorder(outputStream, {
    mimeType: picked.mimeType,
    videoBitsPerSecond: RECORDING_CONFIG.videoBitsPerSecond,
  });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  mediaRecorder.start(RECORDING_CONFIG.timesliceMs);

  try {
    for (const entry of sourceEntries) {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const url = URL.createObjectURL(entry.blob);
      try {
        video.src = url;
        video.load();
        await waitForVideoEvent(video, 'loadedmetadata');
        await drawClipToCanvas(video, context, canvas);
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    }
    await waitForRecorderStop(mediaRecorder);
  } catch (err) {
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    throw err;
  } finally {
    stopStream(outputStream);
  }

  const blob = new Blob(chunks, { type: picked.mimeType });
  if (!blob.size) throw new Error('The final recording was empty.');
  await SessionVideoStore.save(outputKey, blob, {
    mimeType: picked.mimeType,
    videoFormat: picked.format,
  });
  return {
    storageKey: outputKey,
    mimeType: picked.mimeType,
    videoFormat: picked.format,
    size: blob.size,
    segmentIds: sourceEntries.map((entry) => entry.segmentId),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_PING') {
    sendResponse({ ok: true });
    return;
  }

  if (!message.type?.startsWith('OFFSCREEN_')) {
    return false;
  }

  (async () => {
    switch (message.type) {
      case 'OFFSCREEN_START_RECORDING':
        sendResponse({
          ok: true,
          ...(await startRecording(
            message.sessionId,
            message.tabId,
            message.streamId ?? null,
            message.videoFormat,
            message.startPaused,
          )),
        });
        break;
      case 'OFFSCREEN_PAUSE_RECORDING':
        sendResponse({ ok: true, ...(await pauseRecording(message.sessionId)) });
        break;
      case 'OFFSCREEN_RESUME_RECORDING':
        sendResponse({ ok: true, ...(await resumeRecording(message.sessionId)) });
        break;
      case 'OFFSCREEN_RECONNECT_RECORDING':
        sendResponse({
          ok: true,
          ...(await reconnectRecording(message.sessionId, message.streamId, message.videoFormat)),
        });
        break;
      case 'OFFSCREEN_STOP_RECORDING':
        sendResponse({ ok: true, ...(await stopRecording(message.sessionId)) });
        break;
      case 'OFFSCREEN_GET_VIDEO':
        sendResponse({ ok: true, ...(await getVideoBuffer(message.sessionId)) });
        break;
      case 'OFFSCREEN_STITCH_SEGMENTS':
        sendResponse({
          ok: true,
          ...(await stitchRecordingSegments(message.segmentIds, message.outputKey)),
        });
        break;
      default:
        sendResponse({ ok: false, error: `Unknown offscreen message: ${message.type}` });
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

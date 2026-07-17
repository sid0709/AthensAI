(async () => {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId');
  const filename = params.get('filename');

  try {
    if (!sessionId || !filename) {
      throw new Error('Missing download parameters.');
    }

    let blob = null;
    const localEntry = await SessionVideoStore.get(sessionId);
    if (localEntry?.blob?.size) {
      blob = localEntry.blob;
    } else {
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_GET_VIDEO',
        sessionId,
      });
      if (!response?.ok || !response.videoBuffer?.byteLength) {
        throw new Error(response?.error ?? 'Session video not found.');
      }
      blob = new Blob([response.videoBuffer], { type: response.mimeType || 'video/webm' });
    }

    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename, saveAs: false });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    chrome.runtime.sendMessage({ type: 'VIDEO_DOWNLOAD_DONE', sessionId, ok: true });
  } catch (err) {
    console.error('Bid Monitor: video download failed', err);
    chrome.runtime.sendMessage({
      type: 'VIDEO_DOWNLOAD_DONE',
      sessionId,
      ok: false,
      error: err.message,
    });
  } finally {
    window.close();
  }
})();

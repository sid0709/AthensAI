// Local video download helper is retired — recordings upload to Firebase only.
(async () => {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId');
  chrome.runtime.sendMessage({
    type: 'VIDEO_DOWNLOAD_DONE',
    sessionId,
    ok: true,
    skipped: true,
  });
  window.close();
})();

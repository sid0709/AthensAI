(function () {
  const isTopFrame = window.top === window.self;

  let floatingBar = null;
  let toastTimer = null;
  let activeSessionCache = null;
  let applyJobCache = null;
  let profileNameCache = '';
  let recorderStatusCache = 'idle';
  let recordingErrorCache = '';
  let contextInvalidatedNotified = false;

  const TAB_RECORDING_CONFIG = {
    videoBitsPerSecond: 900_000,
    maxWidth: 1280,
    maxHeight: 720,
    maxFrameRate: 15,
    timesliceMs: 2000,
  };

  const tabRecorders = new Map();

  function pickTabRecorderMimeType(preferredFormat) {
    const candidates = preferredFormat === 'mp4'
      ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];

    for (const mimeType of candidates) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return {
          mimeType,
          videoFormat: mimeType.includes('mp4') ? 'mp4' : 'webm',
          fallbackUsed: preferredFormat === 'mp4' && !mimeType.includes('mp4'),
        };
      }
    }

    return { mimeType: 'video/webm', videoFormat: 'webm', fallbackUsed: preferredFormat === 'mp4' };
  }

  async function getTabCaptureStream(streamId) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          maxWidth: TAB_RECORDING_CONFIG.maxWidth,
          maxHeight: TAB_RECORDING_CONFIG.maxHeight,
          maxFrameRate: TAB_RECORDING_CONFIG.maxFrameRate,
        },
      },
    });
  }

  function waitForMediaRecorderStop(mediaRecorder) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      mediaRecorder.addEventListener('stop', resolve, { once: true });
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.requestData();
      }
      mediaRecorder.stop();
    });
  }

  async function startTabRecording(message) {
    const { sessionId, streamId, videoFormat, startPaused } = message;
    if (!sessionId || !streamId) {
      throw new Error('Missing capture stream for tab recording.');
    }
    if (tabRecorders.has(sessionId)) {
      throw new Error('Recording already active on this tab.');
    }

    const picked = pickTabRecorderMimeType(videoFormat === 'mp4' ? 'mp4' : 'webm');
    const stream = await getTabCaptureStream(streamId);
    const chunks = [];
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: picked.mimeType,
      videoBitsPerSecond: TAB_RECORDING_CONFIG.videoBitsPerSecond,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };

    mediaRecorder.start(TAB_RECORDING_CONFIG.timesliceMs);
    if (startPaused && mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
    }

    tabRecorders.set(sessionId, {
      mediaRecorder,
      chunks,
      stream,
      mimeType: picked.mimeType,
      videoFormat: picked.videoFormat,
    });

    return {
      mimeType: picked.mimeType,
      videoFormat: picked.videoFormat,
      fallbackUsed: picked.fallbackUsed,
      startedPaused: Boolean(startPaused),
    };
  }

  async function pauseTabRecording(sessionId) {
    const recorder = tabRecorders.get(sessionId);
    if (!recorder) return { skipped: true };
    if (recorder.mediaRecorder.state === 'recording') {
      recorder.mediaRecorder.pause();
    }
    return { ok: true };
  }

  async function resumeTabRecording(sessionId) {
    const recorder = tabRecorders.get(sessionId);
    if (!recorder) return { skipped: true };
    if (recorder.mediaRecorder.state === 'paused') {
      recorder.mediaRecorder.resume();
    }
    return { ok: true };
  }

  async function stopTabRecording(sessionId) {
    const recorder = tabRecorders.get(sessionId);
    if (!recorder) {
      return { mimeType: 'video/webm', videoFormat: 'webm', size: 0 };
    }

    if (recorder.mediaRecorder.state === 'paused') {
      recorder.mediaRecorder.resume();
    }

    await waitForMediaRecorderStop(recorder.mediaRecorder);
    recorder.stream.getTracks().forEach((track) => track.stop());
    tabRecorders.delete(sessionId);

    const blob = new Blob(recorder.chunks, { type: recorder.mimeType });
    if (blob.size > 0) {
      const videoBuffer = await blob.arrayBuffer();
      const saveResponse = await sendRuntimeMessage({
        type: 'SAVE_SESSION_VIDEO',
        sessionId,
        videoBuffer,
        mimeType: recorder.mimeType,
        videoFormat: recorder.videoFormat,
      });
      if (!saveResponse?.ok) {
        throw new Error(saveResponse?.error || 'Failed to save session video.');
      }
    }

    return {
      mimeType: recorder.mimeType,
      videoFormat: recorder.videoFormat,
      size: blob.size,
    };
  }

  function isExtensionContextValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function notifyContextInvalidated() {
    if (contextInvalidatedNotified || !isTopFrame) return;
    contextInvalidatedNotified = true;
    showToast('Bid Monitor updated — refresh this page');
  }

  async function sendRuntimeMessage(message) {
    if (!isExtensionContextValid()) {
      notifyContextInvalidated();
      return null;
    }

    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      const messageText = String(err?.message || err);
      if (messageText.includes('Extension context invalidated')) {
        notifyContextInvalidated();
        return null;
      }
      throw err;
    }
  }

  function getPanelMount() {
    return document.body || document.documentElement;
  }

  function shouldShowPanel() {
    return Boolean(
      activeSessionCache
      || applyJobCache
      || recorderStatusCache === 'ready'
      || recorderStatusCache === 'starting'
      || recorderStatusCache === 'error',
    );
  }

  function broadcastSessionState() {
    window.dispatchEvent(
      new CustomEvent('bid-monitor-session', {
        detail: {
          isRecording: !!activeSessionCache,
          resumeSetFolder: activeSessionCache?.resumeSetFolder || '',
          expectedResumeName:
            activeSessionCache?.expectedResumeName ||
            applyJobCache?.expectedResumeName ||
            '',
        },
      }),
    );
  }

  function applyStartedPayload(message) {
    profileNameCache = message.profileName ?? profileNameCache;
    applyJobCache = message.job ?? applyJobCache;
    activeSessionCache = message.session ?? activeSessionCache;
    recorderStatusCache = message.recorderStatus ?? 'recording';
    recordingErrorCache = message.error ?? '';
  }

  function applyTabContext(response) {
    if (!response || response.ok === false) return false;

    if (response.applyJob) applyJobCache = response.applyJob;
    if (response.session) activeSessionCache = response.session;
    if (response.auth?.displayName) profileNameCache = response.auth.displayName;
    if (response.recorderStatus) recorderStatusCache = response.recorderStatus;
    recordingErrorCache = response.error ?? response.session?.error ?? '';
    return shouldShowPanel();
  }

  function showToast(message) {
    if (!message) return;

    let toast = document.getElementById('bid-monitor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bid-monitor-toast';
      getPanelMount().appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('visible');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
  }

  function injectStyles() {
    if (document.getElementById('bid-monitor-styles')) return;

    const style = document.createElement('style');
    style.id = 'bid-monitor-styles';
    style.textContent = `
      #bid-monitor-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483646;
        width: min(360px, calc(100vw - 32px));
        padding: 12px 14px;
        background: #7f1d1d;
        color: #fff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
      }

      #bid-monitor-panel.paused {
        background: #92400e;
      }

      #bid-monitor-panel.error {
        background: #991b1b;
      }

      #bid-monitor-panel.ready {
        background: #1e3a8a;
      }

      #bid-monitor-panel.hidden {
        display: none;
      }

      #bid-monitor-panel .panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      #bid-monitor-panel .bid-monitor-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #fca5a5;
        animation: bid-monitor-pulse 1.2s infinite;
        flex-shrink: 0;
      }

      #bid-monitor-panel.paused .bid-monitor-dot {
        background: #fcd34d;
        animation: none;
      }

      #bid-monitor-panel .panel-meta {
        line-height: 1.45;
        margin-bottom: 4px;
        color: #fecaca;
      }

      #bid-monitor-panel.paused .panel-meta {
        color: #fde68a;
      }

      #bid-monitor-panel .panel-meta strong {
        color: #fff;
      }

      #bid-monitor-panel .panel-link {
        color: #fde68a;
        text-decoration: underline;
        word-break: break-all;
      }

      #bid-monitor-finish-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
      }

      #bid-monitor-submit-btn,
      #bid-monitor-skip-btn,
      #bid-monitor-stop-btn {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        background: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      #bid-monitor-submit-btn {
        color: #065f46;
      }

      #bid-monitor-skip-btn,
      #bid-monitor-stop-btn {
        color: #7f1d1d;
      }

      #bid-monitor-panel.paused #bid-monitor-skip-btn,
      #bid-monitor-panel.paused #bid-monitor-stop-btn {
        color: #92400e;
      }

      #bid-monitor-submit-btn:disabled,
      #bid-monitor-skip-btn:disabled,
      #bid-monitor-stop-btn:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      #bid-monitor-retry-btn {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        margin-top: 10px;
        background: #fff;
        color: #991b1b;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      #bid-monitor-retry-btn:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      #bid-monitor-start-btn {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        margin-top: 10px;
        background: #fff;
        color: #1e3a8a;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      #bid-monitor-start-btn:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      @keyframes bid-monitor-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }

      #bid-monitor-toast {
        position: fixed;
        bottom: 140px;
        right: 20px;
        z-index: 2147483647;
        padding: 10px 14px;
        background: #065f46;
        color: #fff;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
      }

      #bid-monitor-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    getPanelMount().appendChild(style);
  }

  function renderPanelContent() {
    if (!floatingBar) return;

    const isApplyFlow = !!applyJobCache;
    const isReady = recorderStatusCache === 'ready';
    const isStarting = recorderStatusCache === 'starting';
    const isError = recorderStatusCache === 'error';
    const isPaused = recorderStatusCache === 'paused';
    const headerLabel = isReady
      ? 'Ready to apply'
      : isError
        ? 'Recording failed'
        : isStarting
          ? 'Starting recording…'
          : isPaused
            ? 'Paused — switch back to resume'
            : isApplyFlow
              ? 'Applying — Recording'
              : 'Recording';

    floatingBar.classList.toggle('ready', isReady);
    floatingBar.classList.toggle('paused', isPaused && !isStarting && !isError && !isReady);
    floatingBar.classList.toggle('error', isError);

    const errorLine = isError && recordingErrorCache
      ? `<div class="panel-meta"><strong>Error:</strong> ${recordingErrorCache}</div>`
      : '';

    const readyLine = isReady
      ? '<div class="panel-meta">Toolbar icon starts recording. Or Submit / Skip without video.</div>'
      : '';

    const profileLine = profileNameCache
      ? `<div class="panel-meta"><strong>Profile:</strong> ${profileNameCache}</div>`
      : '';

    const jobLines = isApplyFlow
      ? `
        <div class="panel-meta"><strong>Company:</strong> ${applyJobCache.companyName}</div>
        <div class="panel-meta"><strong>Title:</strong> ${applyJobCache.title}</div>
        <div class="panel-meta"><strong>Resume:</strong> ${applyJobCache.resumeFolderName}</div>
        <a class="panel-link panel-meta" href="${applyJobCache.jdUrl}" target="_blank" rel="noopener noreferrer">View JD</a>
      `
      : activeSessionCache?.resumeSetFolder
        ? `<div class="panel-meta"><strong>Resume folder:</strong> ${activeSessionCache.resumeSetFolder}</div>`
        : '';

    const finishActionsHtml = `
      <div id="bid-monitor-finish-actions">
        <button id="bid-monitor-submit-btn" type="button" ${isStarting ? 'disabled' : ''}>Submit</button>
        <button id="bid-monitor-skip-btn" type="button" ${isStarting ? 'disabled' : ''}>Skip this Job</button>
      </div>`;

    floatingBar.innerHTML = `
      <div class="panel-header">
        <span class="bid-monitor-dot"></span>
        <span>${headerLabel}</span>
      </div>
      ${profileLine}
      ${jobLines}
      ${readyLine}
      ${errorLine}
      ${isReady
        ? `<button id="bid-monitor-start-btn" type="button">Open recording controls</button>${finishActionsHtml}`
        : isError
          ? '<button id="bid-monitor-retry-btn" type="button">Try Start Recording Again</button>'
          : isApplyFlow
            ? finishActionsHtml
            : `<button id="bid-monitor-stop-btn" type="button" ${isStarting ? 'disabled' : ''}>Stop Recording</button>`}
    `;

    if (isReady) {
      floatingBar.querySelector('#bid-monitor-start-btn')?.addEventListener('click', handleStartClick);
      floatingBar
        .querySelector('#bid-monitor-submit-btn')
        ?.addEventListener('click', () => handleStopClick('submit'));
      floatingBar
        .querySelector('#bid-monitor-skip-btn')
        ?.addEventListener('click', () => handleStopClick('skip'));
    } else if (isError) {
      floatingBar.querySelector('#bid-monitor-retry-btn')?.addEventListener('click', handleStartClick);
    } else if (isApplyFlow) {
      floatingBar
        .querySelector('#bid-monitor-submit-btn')
        ?.addEventListener('click', () => handleStopClick('submit'));
      floatingBar
        .querySelector('#bid-monitor-skip-btn')
        ?.addEventListener('click', () => handleStopClick('skip'));
    } else {
      floatingBar
        .querySelector('#bid-monitor-stop-btn')
        ?.addEventListener('click', () => handleStopClick('submit'));
    }
  }

  async function handleStartClick() {
    const message = 'Click the Bid Monitor toolbar icon on this tab to start recording.';
    recorderStatusCache = 'ready';
    recordingErrorCache = message;
    renderPanelContent();
    showToast(message);
    chrome.runtime.sendMessage({ type: 'REQUEST_PANEL_START_RECORDING' }).catch(() => {});
  }

  async function handleRetryClick() {
    await handleStartClick();
  }

  async function handleStopClick(finishAction = 'submit') {
    const action = finishAction === 'skip' ? 'skip' : 'submit';
    const submitBtn = floatingBar.querySelector('#bid-monitor-submit-btn');
    const skipBtn = floatingBar.querySelector('#bid-monitor-skip-btn');
    const stopBtn = floatingBar.querySelector('#bid-monitor-stop-btn');
    const activeBtn = action === 'skip' ? skipBtn || stopBtn : submitBtn || stopBtn;

    if (submitBtn) submitBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    if (activeBtn) {
      activeBtn.textContent = action === 'skip' ? 'Skipping…' : 'Submitting…';
    }

    const response = await sendRuntimeMessage({
      type: 'STOP_CAPTURE',
      finishAction: action,
      closeApplyTab: Boolean(applyJobCache),
    });

    renderPanelContent();

    if (response?.ok) {
      if (response.jobOutcome === 'skipped') {
        showToast('Skipped — ticket moved to Skipped');
      } else if (response.jobOutcome === 'submitted' || response.jobMarkedApplied) {
        showToast(
          response.uploaded
            ? 'Submitted — recording uploaded'
            : 'Submitted — ticket moved to Submitted',
        );
      } else if (response.uploaded) {
        showToast('Recording uploaded');
      } else if (response.downloaded) {
        showToast('Session saved to Downloads');
      } else {
        showToast('Recording stopped');
      }
      hideFloatingBar();
    } else {
      showToast(response?.error || 'Failed to stop');
    }
  }

  function createFloatingBar() {
    injectStyles();

    const existing = document.getElementById('bid-monitor-panel');
    if (existing) {
      floatingBar = existing;
      return floatingBar;
    }

    floatingBar = document.createElement('div');
    floatingBar.id = 'bid-monitor-panel';
    floatingBar.className = 'hidden';
    getPanelMount().appendChild(floatingBar);
    renderPanelContent();
    return floatingBar;
  }

  function ensurePanelVisible() {
    // The in-page floating widget has been removed — all recording controls
    // live in the side panel now. Keep this a no-op so we never inject UI onto
    // the job page, while the rest of the content script (resume tracking,
    // messaging, PING_CONTENT) keeps working.
    hideFloatingBar();
  }

  function showFloatingBar() {
    ensurePanelVisible();
  }

  function hideFloatingBar() {
    if (floatingBar) floatingBar.classList.add('hidden');
  }

  function updatePanelVisibility() {
    if (!isTopFrame) return;
    if (shouldShowPanel()) {
      ensurePanelVisible();
    } else {
      hideFloatingBar();
    }
  }

  async function refreshTabContext() {
    const response = await sendRuntimeMessage({ type: 'GET_TAB_CONTEXT' });
    return applyTabContext(response);
  }

  async function syncRecordingUI() {
    await refreshTabContext();
    broadcastSessionState();
    updatePanelVisibility();
  }

  function watchPanelMount() {
    if (!isTopFrame) return;

    const reattachIfNeeded = () => {
      if (!shouldShowPanel()) return;
      if (!document.getElementById('bid-monitor-panel')) {
        floatingBar = null;
        ensurePanelVisible();
      }
    };

    const observer = new MutationObserver(reattachIfNeeded);
    const mount = getPanelMount();
    if (mount) {
      observer.observe(mount, { childList: true, subtree: false });
    }

    window.addEventListener('pageshow', reattachIfNeeded);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncRecordingUI().catch(() => {});
      }
    });
  }

  function boot() {
    // Iframes: keep session/resume hooks alive without UI polling.
    if (!isTopFrame) {
      syncRecordingUI().catch(() => {});
      return;
    }

    watchPanelMount();
    syncRecordingUI().catch(() => {});

    setInterval(() => {
      if (!shouldShowPanel()) {
        syncRecordingUI().catch(() => {});
      } else {
        ensurePanelVisible();
      }
    }, 2000);
  }

  if (!window.__bidMonitorListenersAttached) {
    window.__bidMonitorListenersAttached = true;

    window.addEventListener('bid-monitor-resume', (event) => {
      const payload = event.detail;
      if (!payload) return;
      void sendRuntimeMessage({ type: 'RESUME_SELECTED', payload });
    });

    window.addEventListener('bid-monitor-toast', (event) => {
      const message = event.detail?.message;
      if (!message) return;
      // page-hook runs in iframes (ATS embeds); surface toast on the top frame.
      if (isTopFrame) showToast(message);
      else void sendRuntimeMessage({ type: 'SHOW_TOAST', message });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (
        changes.bidMonitorSessions ||
        changes.jobPools ||
        changes.pendingApplyTabs ||
        changes.activeAppliesByJobId ||
        changes.bidReadyCache
      ) {
        if (!isExtensionContextValid()) {
          notifyContextInvalidated();
          return;
        }
        syncRecordingUI().catch(() => {});
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'PING_CONTENT') {
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'SHOW_TOAST') {
        if (isTopFrame && message.message) showToast(String(message.message));
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'SESSION_UPDATED') {
        if (message.recorderStatus) recorderStatusCache = message.recorderStatus;
        if (message.isRecording === false) {
          activeSessionCache = null;
          applyJobCache = null;
          recorderStatusCache = 'idle';
          hideFloatingBar();
        } else {
          updatePanelVisibility();
          void refreshTabContext().then(() => {
            broadcastSessionState();
            updatePanelVisibility();
          });
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'APPLY_STARTED') {
        applyStartedPayload(message);
        broadcastSessionState();
        showFloatingBar();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'SEGMENT_CAPTURE_REQUIRED') {
        if (isTopFrame) {
          showToast(
            message.message || 'Click the Bid Monitor toolbar icon on this tab to start recording.',
          );
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'CONTENT_START_RECORDING') {
        if (!isTopFrame) {
          sendResponse({ ok: false, error: 'Tab recording only runs in the top frame.' });
          return;
        }
        startTabRecording(message)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (message.type === 'CONTENT_PAUSE_RECORDING') {
        if (!isTopFrame) {
          sendResponse({ ok: false, error: 'Tab recording only runs in the top frame.' });
          return;
        }
        pauseTabRecording(message.sessionId)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (message.type === 'CONTENT_RESUME_RECORDING') {
        if (!isTopFrame) {
          sendResponse({ ok: false, error: 'Tab recording only runs in the top frame.' });
          return;
        }
        resumeTabRecording(message.sessionId)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (message.type === 'CONTENT_STOP_RECORDING') {
        if (!isTopFrame) {
          sendResponse({ ok: false, error: 'Tab recording only runs in the top frame.' });
          return;
        }
        stopTabRecording(message.sessionId)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
    });
  }

  window.__bidMonitorResync = () => syncRecordingUI().catch(() => {});

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

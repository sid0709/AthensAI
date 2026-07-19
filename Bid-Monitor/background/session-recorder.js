const SessionRecorder = (() => {
  const tabSessions = new Map();
  let listenersAttached = false;
  let switching = false;

  async function ensureOffscreenDocument() {
    const existing = await chrome.offscreen.hasDocument?.();
    if (!existing) {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Record tab video for bidder monitoring sessions',
      });
      await waitForOffscreenReady();
    }
  }

  async function waitForOffscreenReady() {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' });
        if (response?.ok) return;
      } catch {
        // offscreen not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Offscreen recorder failed to start.');
  }

  async function sendToOffscreen(message) {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage(message);
    if (!response) {
      throw new Error('No response from offscreen recorder.');
    }
    if (response.ok === false) {
      throw new Error(response.error ?? 'Offscreen recorder failed.');
    }
    return response;
  }

  function isCapturableUrl(url) {
    return /^https?:\/\//i.test(url || '');
  }

  async function isTabActive(tabId, windowId) {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    return activeTab?.id === tabId;
  }

  async function getTabStreamId(tabId, { requireActive = true } = {}) {
    const tab = await chrome.tabs.get(tabId);
    if (!isCapturableUrl(tab.url)) {
      throw new Error(
        `Cannot record this page (${tab.url || 'unknown URL'}). Wait until the job site fully loads.`,
      );
    }

    if (requireActive) {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const streamId = await new Promise((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(id);
          });
        });
        return streamId;
      } catch (err) {
        const message = String(err?.message || err);
        const retriable =
          message.includes('has not been invoked') ||
          message.includes('Cannot capture') ||
          message.includes('Chrome pages cannot be captured');

        if (!retriable || attempt === maxAttempts - 1) {
          if (message.includes('has not been invoked')) {
            throw new Error(
              'Could not start recording on this tab. Reload the job page, then try Apply again.',
            );
          }
          if (message.includes('Chrome pages cannot be captured')) {
            throw new Error('This page cannot be recorded. Make sure the job site loaded correctly.');
          }
          throw err;
        }

        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    throw new Error('Failed to start tab recording.');
  }

  function getSessionIdForTab(tabId) {
    return tabSessions.get(tabId)?.sessionId ?? null;
  }

  function removeTabSessionsBySessionId(sessionId) {
    for (const [tabId, meta] of tabSessions) {
      if (meta.sessionId === sessionId) {
        tabSessions.delete(tabId);
      }
    }
    if (!tabSessions.size) detachListeners();
  }

  async function pruneStaleTabSessions() {
    for (const [tabId, meta] of [...tabSessions]) {
      try {
        await chrome.tabs.get(tabId);
      } catch {
        tabSessions.delete(tabId);
        try {
          await sendToOffscreen({ type: 'OFFSCREEN_STOP_RECORDING', sessionId: meta.sessionId });
        } catch {
          // Offscreen recorder may already be gone.
        }
      }
    }

    if (!tabSessions.size) detachListeners();
  }

  async function sendToTab(tabId, message, maxAttempts = 15) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, message);
        if (!response) {
          throw new Error('No response from tab recorder.');
        }
        if (response.ok === false) {
          throw new Error(response.error ?? 'Tab recorder failed.');
        }
        return response;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError ?? new Error('Tab recorder did not respond.');
  }

  function findTabIdForSession(sessionId) {
    for (const [tabId, meta] of tabSessions) {
      if (meta.sessionId === sessionId) return tabId;
    }
    return null;
  }

  async function pauseSession(sessionId) {
    if (!sessionId) return;
    const tabId = findTabIdForSession(sessionId);
    const meta = tabId != null ? tabSessions.get(tabId) : null;

    if (meta?.recordInTab && tabId != null) {
      await sendToTab(tabId, { type: 'CONTENT_PAUSE_RECORDING', sessionId });
      meta.paused = true;
      tabSessions.set(tabId, meta);
      return;
    }

    const response = await sendToOffscreen({ type: 'OFFSCREEN_PAUSE_RECORDING', sessionId });
    if (response?.skipped) {
      removeTabSessionsBySessionId(sessionId);
      return;
    }

    for (const [tabId, meta] of tabSessions) {
      if (meta.sessionId === sessionId) {
        meta.paused = true;
        tabSessions.set(tabId, meta);
      }
    }
  }

  async function resumeSession(sessionId, tabId) {
    if (!sessionId) return;
    const meta = tabSessions.get(tabId);

    if (meta?.recordInTab) {
      await sendToTab(tabId, { type: 'CONTENT_RESUME_RECORDING', sessionId });
      meta.paused = false;
      tabSessions.set(tabId, meta);
      return;
    }

    const response = await sendToOffscreen({ type: 'OFFSCREEN_RESUME_RECORDING', sessionId });
    if (response?.skipped) {
      removeTabSessionsBySessionId(sessionId);
      return;
    }

    if (meta) {
      meta.paused = false;
      tabSessions.set(tabId, meta);
    }
  }

  async function reconnectSession(sessionId, tabId, videoFormat) {
    const streamId = await getTabStreamId(tabId, { requireActive: true });
    await sendToOffscreen({
      type: 'OFFSCREEN_RECONNECT_RECORDING',
      sessionId,
      streamId,
      videoFormat,
    });
  }

  async function syncWindowRecorders(windowId, activeTabId) {
    if (switching) return;
    switching = true;
    try {
      await pruneStaleTabSessions();

      for (const [tabId, meta] of tabSessions) {
        if (meta.windowId !== windowId) continue;
        try {
          if (tabId === activeTabId) {
            await resumeSession(meta.sessionId, tabId);
          } else {
            await pauseSession(meta.sessionId);
          }
        } catch (err) {
          console.warn('Bid Monitor: recorder sync failed for tab', tabId, err);
          tabSessions.delete(tabId);
        }
      }
    } finally {
      switching = false;
    }
  }

  async function onTabActivated(activeInfo) {
    if (!tabSessions.size) return;
    await syncWindowRecorders(activeInfo.windowId, activeInfo.tabId);
  }

  async function onTabUpdated(tabId, changeInfo, tab) {
    if (!tabSessions.has(tabId)) return;
    if (changeInfo.status !== 'complete') return;
    if (!isCapturableUrl(tab.url)) return;

    const meta = tabSessions.get(tabId);
    if (meta?.recordInTab) {
      return;
    }

    const isActive = await isTabActive(tabId, tab.windowId);
    if (!isActive) return;

    if (!meta || switching) return;

    switching = true;
    try {
      await reconnectSession(meta.sessionId, tabId, meta.videoFormat);
      await resumeSession(meta.sessionId, tabId);
      await syncWindowRecorders(tab.windowId, tabId);
    } catch (err) {
      console.warn('Bid Monitor: navigation reconnect failed', err);
    } finally {
      switching = false;
    }
  }

  async function onTabRemoved(tabId) {
    if (!tabSessions.has(tabId)) return;
    const meta = tabSessions.get(tabId);
    tabSessions.delete(tabId);
    try {
      if (meta.recordInTab) {
        await sendToTab(tabId, { type: 'CONTENT_STOP_RECORDING', sessionId: meta.sessionId }).catch(() => {});
      } else {
        await sendToOffscreen({ type: 'OFFSCREEN_STOP_RECORDING', sessionId: meta.sessionId });
      }
    } catch (err) {
      console.warn('Bid Monitor: cleanup on tab close failed', err);
    }
    if (!tabSessions.size) detachListeners();
  }

  function attachListeners() {
    if (listenersAttached) return;
    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    chrome.tabs.onActivated.removeListener(onTabActivated);
    chrome.tabs.onUpdated.removeListener(onTabUpdated);
    chrome.tabs.onRemoved.removeListener(onTabRemoved);
    listenersAttached = false;
  }

  async function startRecordingOnTab(sessionId, tab, options = {}) {
    const tabId = tab.id;
    if (tabSessions.has(tabId)) {
      throw new Error('This tab already has an active recording.');
    }

    const videoFormat = options.videoFormat === 'mp4' ? 'mp4' : 'webm';
    const isActive = await isTabActive(tabId, tab.windowId);
    const recordInTab = Boolean(options.recordInTab && options.streamId);

    await chrome.tabs.update(tabId, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 400));

    let response;
    if (recordInTab) {
      response = await sendToTab(tabId, {
        type: 'CONTENT_START_RECORDING',
        sessionId,
        streamId: options.streamId,
        videoFormat,
        startPaused: !isActive,
      });
    } else {
      await ensureOffscreenDocument();
      response = await sendToOffscreen({
        type: 'OFFSCREEN_START_RECORDING',
        sessionId,
        tabId,
        streamId: options.streamId ?? null,
        videoFormat,
        startPaused: !isActive,
      });
    }

    tabSessions.set(tabId, {
      sessionId,
      windowId: tab.windowId,
      videoFormat,
      paused: !isActive,
      recordInTab,
    });

    attachListeners();
    const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    await syncWindowRecorders(tab.windowId, isActive ? tabId : activeTab?.id);

    return {
      mimeType: response.mimeType,
      videoFormat: response.videoFormat ?? videoFormat,
      fallbackUsed: response.fallbackUsed ?? false,
      startedPaused: response.startedPaused ?? !isActive,
      windowId: tab.windowId,
      tabId,
    };
  }

  async function start(sessionId, tab, options = {}) {
    return startRecordingOnTab(sessionId, tab, options);
  }

  async function startWithStreamId(sessionId, tab, _streamId, options = {}) {
    return startRecordingOnTab(sessionId, tab, options);
  }

  async function restore(sessions) {
    await pruneStaleTabSessions();
    if (!sessions?.length) return;

    attachListeners();
    for (const session of sessions) {
      if (!session?.id || !session.tabId) continue;

      try {
        await chrome.tabs.get(session.tabId);
      } catch {
        continue;
      }

      tabSessions.set(session.tabId, {
        sessionId: session.id,
        windowId: session.recordingWindowId,
        videoFormat: session.videoFormat === 'mp4' ? 'mp4' : 'webm',
        paused: session.recorderStatus === 'paused',
      });
    }

    const windows = [...new Set(sessions.map((s) => s.recordingWindowId).filter(Boolean))];
    for (const windowId of windows) {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId });
      if (activeTab?.id) {
        await syncWindowRecorders(windowId, activeTab.id);
      }
    }
  }

  async function stop(sessionId) {
    if (!sessionId) return null;

    let tabIdToRemove = null;
    let recordInTab = false;
    for (const [tabId, meta] of tabSessions) {
      if (meta.sessionId === sessionId) {
        tabIdToRemove = tabId;
        recordInTab = Boolean(meta.recordInTab);
        break;
      }
    }

    let response;
    if (recordInTab && tabIdToRemove != null) {
      response = await sendToTab(tabIdToRemove, {
        type: 'CONTENT_STOP_RECORDING',
        sessionId,
      });
    } else {
      await ensureOffscreenDocument();
      response = await sendToOffscreen({
        type: 'OFFSCREEN_STOP_RECORDING',
        sessionId,
      });
    }

    if (tabIdToRemove != null) {
      tabSessions.delete(tabIdToRemove);
    }

    if (!tabSessions.size) {
      detachListeners();
    }

    return {
      sessionId,
      tabId: tabIdToRemove,
      mimeType: response.mimeType,
      videoFormat: response.videoFormat,
      size: response.size,
    };
  }

  async function stitchSegments(segmentIds, outputKey) {
    if (!Array.isArray(segmentIds) || !segmentIds.length) {
      return {
        storageKey: null,
        mimeType: 'video/webm',
        videoFormat: 'webm',
        size: 0,
        segmentIds: [],
      };
    }
    return sendToOffscreen({
      type: 'OFFSCREEN_STITCH_SEGMENTS',
      segmentIds,
      outputKey,
    });
  }

  function hasActiveRecordings() {
    return tabSessions.size > 0;
  }

  function getPausedState(sessionId) {
    for (const meta of tabSessions.values()) {
      if (meta.sessionId === sessionId) return meta.paused;
    }
    return false;
  }

  return {
    start,
    startWithStreamId,
    restore,
    stop,
    pruneStaleTabSessions,
    hasActiveRecordings,
    getSessionIdForTab,
    getPausedState,
    syncWindowRecorders,
    getTabStreamId,
    isCapturableUrl,
    stitchSegments,
  };
})();

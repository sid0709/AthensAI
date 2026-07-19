/**
 * Multi-tab segment recording orchestration.
 * Depends on: SessionMatching, ApplicationSessionStore, SessionRecorder,
 * SessionVideoStore, SegmentStitch, ApplyLifecycle (via callers for job sync).
 */
const SegmentLifecycle = (() => {
  let listenersAttached = false;
  /** tabIds we already attempted unassigned capture for */
  const attemptedUnassignedTabs = new Set();

  function broadcast(type, payload = {}) {
    chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
  }

  async function refreshNeedsMergeBadge() {
    if (typeof updateNeedsMergeBadge === 'function') {
      try {
        await updateNeedsMergeBadge();
      } catch {
        // Badge helper may not be ready during early SW boot.
      }
    }
  }

  async function notifyClipWaiting(segment, { empty = false } = {}) {
    if (!chrome.notifications?.create) return;
    const domain = segment?.domain || 'this tab';
    const notificationId = `bid-monitor-clip-${segment?.segmentId || Date.now()}`;
    try {
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: empty ? "Recording didn't start" : 'Recording saved',
        message: empty
          ? `Nothing was captured on ${domain}. Open Bid Monitor to dismiss.`
          : `Clip from ${domain} is waiting. Open Bid Monitor to attach it to a job.`,
        priority: 1,
      });
    } catch (err) {
      console.warn('Bid Monitor: notification failed', err);
    }
  }

  async function openSidePanelBestEffort() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.windowId != null) {
        await chrome.sidePanel.open({ windowId: activeTab.windowId });
      }
    } catch {
      // Chrome rejects sidePanel.open without a user gesture.
    }
  }

  async function promptUnassignedClip(segment, { hasRecording }) {
    if (hasRecording) {
      const active = await ApplicationSessionStore.listActiveSessions();
      for (const session of active) {
        await ApplicationSessionStore.upsertSession(session.sessionId, {
          status: 'needs_merge',
        });
      }
      await ApplicationSessionStore.setPendingMerge(segment.segmentId);
      broadcast('SHOW_MERGE_MODAL', { segmentId: segment.segmentId });
      await notifyClipWaiting(segment, { empty: false });
    } else {
      const marked = await ApplicationSessionStore.upsertSegment(segment.segmentId, {
        status: 'failed',
        emptyRecording: true,
        sessionId: null,
        error:
          "Recording didn't start — the tab may have closed too fast, or capture wasn't granted.",
      });
      await notifyClipWaiting(marked || segment, { empty: true });
    }
    await openSidePanelBestEffort();
    await refreshNeedsMergeBadge();
    broadcast('APPLICATION_SESSIONS_UPDATED');
  }

  async function openSidePanelForTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId != null) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch {
      // Side panel may already be open or unavailable.
    }
  }

  async function requestCaptureGesture(segment, tab) {
    const message = 'Click the Bid Monitor toolbar icon on this tab to start recording.';
    await ApplicationSessionStore.upsertSegment(segment.segmentId, {
      status: segment.sessionId ? 'failed' : 'unassigned',
      error: message,
    });
    if (segment.sessionId) {
      await ApplicationSessionStore.upsertSession(segment.sessionId, {
        warning: message,
      });
    }
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
    chrome.action
      .setBadgeBackgroundColor({ tabId: tab.id, color: '#d97706' })
      .catch(() => {});
    chrome.action
      .setTitle({ tabId: tab.id, title: 'Bid Monitor: tap to record this application tab' })
      .catch(() => {});
    chrome.tabs
      .sendMessage(tab.id, { type: 'SEGMENT_CAPTURE_REQUIRED', message })
      .catch(() => {});
    await openSidePanelForTab(tab.id);
    broadcast('APPLICATION_SESSIONS_UPDATED');
    return { ok: false, needsGesture: true, error: message };
  }

  /**
   * Start MediaRecorder for a segment. Uses segmentId as SessionRecorder session key.
   */
  async function startSegmentCapture(segment, tab, { streamId = null, videoFormat = 'webm' } = {}) {
    // Chrome only grants tabCapture after a user gesture on the target tab.
    // Lifecycle events can classify the tab, but must not repeatedly attempt a
    // capture that Chrome will reject.
    if (!streamId) return requestCaptureGesture(segment, tab);

    try {
      const recording = await SessionRecorder.start(segment.segmentId, tab, {
        videoFormat,
        streamId,
        recordInTab: false,
      });
      await ApplicationSessionStore.upsertSegment(segment.segmentId, {
        status: segment.sessionId ? 'recording' : 'unassigned',
        mimeType: recording.mimeType,
        videoFormat: recording.videoFormat,
        url: tab.url || segment.url,
        domain: SessionMatching.extractDomain(tab.url || segment.url),
        error: null,
      });
      chrome.action.setBadgeText({ tabId: tab.id, text: 'REC' }).catch(() => {});
      chrome.action
        .setBadgeBackgroundColor({ tabId: tab.id, color: '#dc2626' })
        .catch(() => {});
      chrome.action
        .setTitle({ tabId: tab.id, title: 'Bid Monitor: recording this tab' })
        .catch(() => {});
      return { ok: true, recording };
    } catch (err) {
      await ApplicationSessionStore.upsertSegment(segment.segmentId, {
        status: 'failed',
        error: String(err?.message || err),
      });
      if (segment.sessionId) {
        await ApplicationSessionStore.upsertSession(segment.sessionId, {
          warning: 'Click the Bid Monitor toolbar icon on this tab to start recording.',
        });
      }
      broadcast('APPLICATION_SESSIONS_UPDATED');
      return { ok: false, error: err?.message || 'start failed' };
    }
  }

  /**
   * Stop capture for a tab's segment and persist the blob under segmentId.
   */
  async function stopSegmentForTab(
    tabId,
    { closeReason = 'tab_closed', preserveTab = false } = {},
  ) {
    const segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
    if (!segment) return null;

    let stopped = null;
    try {
      // Prefer segment id as recorder key; fall back to legacy session id on tab
      const recorderKey =
        SessionRecorder.getSessionIdForTab(tabId) || segment.segmentId;
      stopped = await SessionRecorder.stop(recorderKey);
    } catch (err) {
      console.warn('Bid Monitor: stop segment failed', err);
    }

    // Offscreen stop already saves via SAVE_SESSION_VIDEO with sessionId = segmentId
    // when we started with segmentId. Also copy if stored under recorder key.
    if (stopped?.sessionId && stopped.sessionId !== segment.segmentId) {
      try {
        const entry = await SessionVideoStore.get(stopped.sessionId);
        if (entry?.blob) {
          await SessionVideoStore.saveSegment(segment.segmentId, entry.blob, {
            mimeType: entry.mimeType,
            videoFormat: entry.videoFormat,
          });
        }
      } catch {
        // ignore
      }
    }

    const entry = await SessionVideoStore.getSegment(segment.segmentId);
    const nextStatus =
      segment.status === 'unassigned' || !segment.sessionId
        ? 'unassigned'
        : 'merged';

    const updated = await ApplicationSessionStore.upsertSegment(segment.segmentId, {
      status: nextStatus,
      endedAt: new Date().toISOString(),
      closeReason,
      mimeType: entry?.mimeType || stopped?.mimeType || segment.mimeType,
      videoFormat: entry?.videoFormat || stopped?.videoFormat || segment.videoFormat,
      videoSizeBytes: entry?.blob?.size ?? stopped?.size ?? segment.videoSizeBytes,
    });

    await ApplicationSessionStore.unlinkSegmentTab(tabId);

    if (!preserveTab) {
      await ApplicationSessionStore.unlinkTab(tabId);
    }
    if (segment.sessionId && !preserveTab) {
      await ApplicationSessionStore.removeTabFromSession(segment.sessionId, tabId);
    }

    return updated;
  }

  async function startManualSegment(tabId, streamId) {
    if (tabId == null || !streamId) {
      throw new Error('This tab is not ready to record.');
    }
    const tab = await chrome.tabs.get(tabId);
    if (!SessionRecorder.isCapturableUrl(tab.url)) {
      throw new Error('This page cannot be recorded.');
    }

    let segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
    if (segment && SessionRecorder.getSessionIdForTab(tabId)) {
      return { ok: true, alreadyRecording: true, segment };
    }

    if (!segment) {
      const session = await ApplicationSessionStore.getSessionByTabId(tabId);
      segment = await ApplicationSessionStore.createSegment({
        sessionId: session?.sessionId || null,
        tabId,
        openerTabId: tab.openerTabId ?? null,
        url: tab.url || '',
        status: session ? 'recording' : 'unassigned',
      });
    }

    const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
    const result = await startSegmentCapture(segment, tab, { streamId, videoFormat });
    if (!result.ok) throw new Error(result.error || 'Could not start recording.');
    broadcast('APPLICATION_SESSIONS_UPDATED');
    return { ...result, segment: await ApplicationSessionStore.getSegment(segment.segmentId) };
  }

  async function stopManualSegment(tabId) {
    const segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
    if (!segment || !SessionRecorder.getSessionIdForTab(tabId)) {
      return { ok: false, error: 'This tab is not being recorded.' };
    }

    const wasUnassigned = segment.status === 'unassigned' || !segment.sessionId;
    const updated = await stopSegmentForTab(tabId, {
      closeReason: 'manual_stop',
      preserveTab: true,
    });
    const hasRecording = Number(updated?.videoSizeBytes) > 0;

    if (wasUnassigned && updated) {
      await promptUnassignedClip(updated, { hasRecording });
    }

    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action
      .setTitle({ tabId, title: 'Bid Monitor' })
      .catch(() => {});
    if (!wasUnassigned) {
      broadcast('APPLICATION_SESSIONS_UPDATED');
      await refreshNeedsMergeBadge();
    }
    return {
      ok: true,
      segment: updated,
      needsMerge: wasUnassigned && hasRecording,
      emptyRecording: wasUnassigned && !hasRecording,
    };
  }

  async function getTabRecordingState(tabId) {
    if (tabId == null) return { isRecording: false, segment: null };
    const segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
    return {
      isRecording: Boolean(SessionRecorder.getSessionIdForTab(tabId)),
      segment,
      assigned: Boolean(segment?.sessionId),
    };
  }

  async function handleTabCreated(tab) {
    if (!tab?.id) return;
    const openerTabId = tab.openerTabId ?? null;
    if (openerTabId == null) return;

    const sessions = await ApplicationSessionStore.listActiveSessions();
    if (!sessions.length) return;

    const initialUrl = tab.url || tab.pendingUrl || '';
    if (!/^https?:\/\//i.test(initialUrl)) {
      // The regular onUpdated handler will classify the tab once Chrome exposes
      // its destination. Avoid attaching about:blank before we can exclude mail.
      return;
    }

    const tabIndex = await ApplicationSessionStore.getTabSessionIndex();
    const match = SessionMatching.matchSessionForTab({
      openerTabId,
      domain: SessionMatching.extractDomain(initialUrl),
      sessions,
      tabIndex,
    });

    if (match.action !== 'auto' || !match.recommendedSessionId) return;

    // Skip mail domains even with opener (shouldn't happen often)
    const domain = SessionMatching.extractDomain(initialUrl);
    if (SessionMatching.isExternalMailDomain(domain)) return;

    const sessionId = match.recommendedSessionId;
    const segment = await ApplicationSessionStore.createSegment({
      sessionId,
      tabId: tab.id,
      openerTabId,
      url: initialUrl,
      status: 'recording',
    });

    const appSession = await ApplicationSessionStore.getSession(sessionId);
    if (appSession?.jobId) {
      await ApplyLifecycle.linkAdditionalTab(appSession.jobId, tab.id);
      await ApplyLifecycle.upsert(appSession.jobId, {
        applyTabId: tab.id,
        activeTabIds: [...(appSession.activeTabIds || []), tab.id],
      });
    }

    const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
    await startSegmentCapture(segment, tab, { videoFormat });
    broadcast('APPLICATION_SESSIONS_UPDATED');
  }

  async function handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete' && !changeInfo.url) return;
    if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return;

    const domain = SessionMatching.extractDomain(tab.url);
    if (SessionMatching.isExternalMailDomain(domain)) return;

    // Already tracked?
    const existing = await ApplicationSessionStore.getSegmentByTabId(tabId);
    if (existing) {
      await ApplicationSessionStore.upsertSegment(existing.segmentId, {
        url: tab.url,
        domain,
      });
      return;
    }

    // A session index is written before its first segment. This closes the race
    // where the Apply tab's load event could create a duplicate unassigned clip.
    const trackedSession = await ApplicationSessionStore.getSessionByTabId(tabId);
    if (trackedSession) return;

    const sessions = await ApplicationSessionStore.listActiveSessions();
    if (!sessions.length) return;

    // Only consider ATS-like pages for unassigned capture
    if (!SessionMatching.isKnownAtsDomain(domain)) {
      // Also allow exact domain match to an active session's original domain
      const exact = sessions.some((s) => SessionMatching.domainMatches(s.originalDomain, domain));
      if (!exact) return;
    }

    if (attemptedUnassignedTabs.has(tabId)) return;

    const tabIndex = await ApplicationSessionStore.getTabSessionIndex();
    const match = SessionMatching.matchSessionForTab({
      openerTabId: tab.openerTabId ?? null,
      domain,
      sessions,
      tabIndex,
    });

    if (match.action === 'auto' && match.recommendedSessionId) {
      // Child that got URL late — attach
      const segment = await ApplicationSessionStore.createSegment({
        sessionId: match.recommendedSessionId,
        tabId,
        openerTabId: tab.openerTabId ?? null,
        url: tab.url,
        status: 'recording',
      });
      attemptedUnassignedTabs.add(tabId);
      const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
      await startSegmentCapture(segment, tab, { videoFormat });
      broadcast('APPLICATION_SESSIONS_UPDATED');
      return;
    }

    // Unassigned verification-style tab
    if (match.action === 'none' || match.action === 'suggest' || match.action === 'ask') {
      // If opener was mail or missing and this is ATS → unassigned
      const openerIsExternal =
        tab.openerTabId == null ||
        !(await ApplicationSessionStore.getSessionByTabId(tab.openerTabId));

      if (!openerIsExternal && match.action === 'auto') return;

      if (!SessionMatching.isKnownAtsDomain(domain) && match.action === 'none') return;

      attemptedUnassignedTabs.add(tabId);
      const segment = await ApplicationSessionStore.createSegment({
        sessionId: null,
        tabId,
        openerTabId: tab.openerTabId ?? null,
        url: tab.url,
        status: 'unassigned',
      });
      const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
      await startSegmentCapture(segment, tab, { videoFormat });
      broadcast('APPLICATION_SESSIONS_UPDATED');
    }
  }

  async function handleTabRemoved(tabId) {
    attemptedUnassignedTabs.delete(tabId);

    const segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
    if (!segment) {
      // May still be an apply tab without segment
      const session = await ApplicationSessionStore.getSessionByTabId(tabId);
      if (session) {
        await ApplicationSessionStore.removeTabFromSession(session.sessionId, tabId);
        if (!(session.activeTabIds || []).filter((id) => Number(id) !== Number(tabId)).length) {
          await ApplicationSessionStore.setPendingFinishPrompt(session.sessionId);
          broadcast('SHOW_FINISH_PROMPT', { sessionId: session.sessionId });
          try {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (active?.windowId != null) {
              await chrome.sidePanel.open({ windowId: active.windowId });
            }
          } catch {
            // ignore
          }
        }
        broadcast('APPLICATION_SESSIONS_UPDATED');
      }
      return;
    }

    const wasUnassigned = segment.status === 'unassigned' || !segment.sessionId;
    const updated = await stopSegmentForTab(tabId, { closeReason: 'tab_closed' });
    const hasRecording = Number(updated?.videoSizeBytes) > 0;

    if (!wasUnassigned && updated && !hasRecording && segment.sessionId) {
      await ApplicationSessionStore.discardSegment(updated.segmentId);
      const session = await ApplicationSessionStore.getSession(segment.sessionId);
      const remainingIds = (session?.recordingSegmentIds || []).filter(
        (id) => id !== updated.segmentId,
      );
      const remaining = await ApplicationSessionStore.getSegmentsForSession(segment.sessionId);
      const stillFailed = remaining.some(
        (candidate) =>
          candidate.segmentId !== updated.segmentId && candidate.status === 'failed',
      );
      await ApplicationSessionStore.upsertSession(segment.sessionId, {
        recordingSegmentIds: remainingIds,
        warning: stillFailed ? session?.warning : null,
      });
    }

    if (wasUnassigned && updated) {
      await promptUnassignedClip(updated, { hasRecording });
    } else if (segment.sessionId) {
      const session = await ApplicationSessionStore.getSession(segment.sessionId);
      if (session && !(session.activeTabIds || []).length) {
        await ApplicationSessionStore.setPendingFinishPrompt(session.sessionId);
        broadcast('SHOW_FINISH_PROMPT', { sessionId: session.sessionId });
        await openSidePanelBestEffort();
      }
      broadcast('APPLICATION_SESSIONS_UPDATED');
      await refreshNeedsMergeBadge();
    } else {
      broadcast('APPLICATION_SESSIONS_UPDATED');
      await refreshNeedsMergeBadge();
    }
  }

  /**
   * Create application session + first segment when Apply opens a job tab.
   */
  async function onApplyOpened({
    jobId,
    jobTitle,
    companyName,
    originalJobUrl,
    tabId,
    poolId,
    athensJobId,
    streamId = null,
  }) {
    const existing = await ApplicationSessionStore.getSessionByJobId(jobId);
    let session = existing;
    if (!session) {
      session = await ApplicationSessionStore.createSession({
        jobId,
        jobTitle,
        companyName,
        originalJobUrl,
        tabId,
        poolId,
        athensJobId,
      });
    } else {
      await ApplicationSessionStore.upsertSession(session.sessionId, {
        status: 'recording',
        activeTabIds: [...new Set([...(session.activeTabIds || []), tabId])],
      });
      await ApplicationSessionStore.linkTab(session.sessionId, tabId);
    }

    await ApplyLifecycle.upsert(jobId, {
      applicationSessionId: session.sessionId,
      applyTabId: tabId,
    });

    const segment = await ApplicationSessionStore.createSegment({
      sessionId: session.sessionId,
      tabId,
      openerTabId: null,
      url: originalJobUrl,
      status: 'recording',
    });

    let captureResult = { ok: false };
    if (streamId) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
        captureResult = await startSegmentCapture(segment, tab, { streamId, videoFormat });
      } catch (err) {
        captureResult = { ok: false, error: err?.message };
      }
    }

    broadcast('APPLICATION_SESSIONS_UPDATED');
    return { session, segment, captureResult };
  }

  async function mergePendingSegment(segmentId, sessionId) {
    const result = await ApplicationSessionStore.attachSegmentToSession(segmentId, sessionId);
    await ApplicationSessionStore.clearPendingMerge();
    // Restore other sessions from needs_merge if no unassigned left
    const unassigned = await ApplicationSessionStore.getUnassignedSegments();
    if (!unassigned.length) {
      const active = await ApplicationSessionStore.listActiveSessions();
      for (const s of active) {
        if (s.status === 'needs_merge') {
          await ApplicationSessionStore.upsertSession(s.sessionId, { status: 'recording' });
        }
      }
    }
    broadcast('APPLICATION_SESSIONS_UPDATED');
    await refreshNeedsMergeBadge();
    return result;
  }

  async function discardPendingSegment(segmentId) {
    await ApplicationSessionStore.discardSegment(segmentId);
    try {
      await SessionVideoStore.deleteSegment(segmentId);
    } catch {
      // ignore
    }
    await ApplicationSessionStore.clearPendingMerge();
    const unassigned = await ApplicationSessionStore.getUnassignedSegments();
    const empty = await ApplicationSessionStore.getEmptyRecordingClips();
    if (!unassigned.length && !empty.length) {
      const active = await ApplicationSessionStore.listActiveSessions();
      for (const s of active) {
        if (s.status === 'needs_merge') {
          await ApplicationSessionStore.upsertSession(s.sessionId, { status: 'recording' });
        }
      }
    }
    broadcast('APPLICATION_SESSIONS_UPDATED');
    await refreshNeedsMergeBadge();
  }

  async function keepUnassignedForLater(segmentId) {
    await ApplicationSessionStore.clearPendingMerge();
    broadcast('APPLICATION_SESSIONS_UPDATED');
    await refreshNeedsMergeBadge();
  }

  /**
   * Stop all live segments for a session, stitch, return final blob metadata.
   */
  async function finalizeSessionVideo(sessionId) {
    const session = await ApplicationSessionStore.getSession(sessionId);
    if (!session) return { blob: null, mimeType: 'video/webm', segmentIds: [], usedFallback: false };

    // Stop any still-recording segments
    for (const tabId of [...(session.activeTabIds || [])]) {
      try {
        await stopSegmentForTab(tabId, { closeReason: 'session_finished' });
      } catch {
        // ignore
      }
    }

    // Also stop by segment ids that may still be in SessionRecorder
    const segments = await ApplicationSessionStore.getSegmentsForSession(sessionId);
    for (const seg of segments) {
      if (seg.status === 'recording') {
        try {
          await SessionRecorder.stop(seg.segmentId);
        } catch {
          // ignore
        }
        await ApplicationSessionStore.markSegmentEnded(seg.segmentId, {
          closeReason: 'session_finished',
          status: 'merged',
        });
      }
    }

    const fresh = await ApplicationSessionStore.getSegmentsForSession(sessionId);
    const forVideo = SessionMatching.orderSegmentsForFinalVideo(fresh);
    if (!forVideo.length) {
      return {
        blob: null,
        mimeType: 'video/webm',
        segmentIds: [],
        usedFallback: false,
      };
    }

    const outputKey = `final-${sessionId}`;
    try {
      const stitched = await SessionRecorder.stitchSegments(
        forVideo.map((segment) => segment.segmentId),
        outputKey,
      );
      const stored = stitched.storageKey
        ? await SessionVideoStore.get(stitched.storageKey)
        : null;
      return {
        blob: stored?.blob || null,
        mimeType: stitched.mimeType || stored?.mimeType || 'video/webm',
        segmentIds: stitched.segmentIds || [],
        usedFallback: false,
      };
    } catch (err) {
      console.error('Bid Monitor: final video re-encode failed', err);
      const first = await SessionVideoStore.getSegment(forVideo[0].segmentId);
      return {
        blob: first?.blob || null,
        mimeType: first?.mimeType || first?.blob?.type || 'video/webm',
        segmentIds: first?.blob ? [forVideo[0].segmentId] : [],
        usedFallback: true,
      };
    }
  }

  /**
   * Resume capture for a failed segment after a user-approved capture request.
   */
  async function resumeFailedSegmentOnTab(tab, streamId) {
    const segment = await ApplicationSessionStore.getSegmentByTabId(tab.id);
    if (!segment) return { ok: false, reason: 'no_segment' };
    if (segment.status !== 'failed' && SessionRecorder.getSessionIdForTab(tab.id)) {
      return { ok: false, reason: 'already_recording' };
    }
    const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
    await ApplicationSessionStore.upsertSegment(segment.segmentId, {
      status: segment.sessionId ? 'recording' : 'unassigned',
      error: null,
    });
    const result = await startSegmentCapture(segment, tab, { streamId, videoFormat });
    if (result.ok && segment.sessionId) {
      await ApplicationSessionStore.upsertSession(segment.sessionId, { warning: null });
    }
    broadcast('APPLICATION_SESSIONS_UPDATED');
    return result;
  }

  function attachListeners() {
    if (listenersAttached) return;
    chrome.tabs.onCreated.addListener((tab) => {
      handleTabCreated(tab).catch(console.error);
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      handleTabUpdated(tabId, changeInfo, tab).catch(console.error);
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      handleTabRemoved(tabId).catch(console.error);
    });
    listenersAttached = true;
  }

  async function restoreFromStorage() {
    attachListeners();
    // Metadata only — live MediaRecorder cannot be restored; mark recording segments as needing gesture
    const sessions = await ApplicationSessionStore.listActiveSessions();
    const allSegMap = await chrome.storage.local.get('recordingSegmentsById');
    const segments = allSegMap.recordingSegmentsById || {};
    for (const session of sessions) {
      for (const segId of session.recordingSegmentIds || []) {
        const seg = segments[segId];
        if (seg?.status === 'recording') {
          await ApplicationSessionStore.upsertSegment(segId, {
            status: 'failed',
            error: 'Recording interrupted — click the Bid Monitor toolbar icon on this tab.',
          });
          await ApplicationSessionStore.upsertSession(session.sessionId, {
            warning: 'Click the Bid Monitor toolbar icon on the job tab to resume.',
          });
        }
      }
    }
    broadcast('APPLICATION_SESSIONS_UPDATED');
    await refreshNeedsMergeBadge();
  }

  return {
    attachListeners,
    restoreFromStorage,
    onApplyOpened,
    startSegmentCapture,
    stopSegmentForTab,
    startManualSegment,
    stopManualSegment,
    getTabRecordingState,
    mergePendingSegment,
    discardPendingSegment,
    keepUnassignedForLater,
    finalizeSessionVideo,
    resumeFailedSegmentOnTab,
    handleTabCreated,
    handleTabUpdated,
    handleTabRemoved,
  };
})();

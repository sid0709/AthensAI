/**
 * ApplicationSession + RecordingSegment persistence for multi-tab apply recording.
 * Depends on SessionMatching (importScripts order).
 */
const ApplicationSessionStore = (() => {
  const SESSIONS_KEY = 'applicationSessionsById';
  const SEGMENTS_KEY = 'recordingSegmentsById';
  const TAB_SESSION_INDEX_KEY = 'tabToSessionIndex';
  const TAB_SEGMENT_INDEX_KEY = 'tabToSegmentIndex';
  const PENDING_MERGE_KEY = 'pendingMergeSegmentId';
  const PENDING_FINISH_PROMPT_KEY = 'pendingFinishPromptSessionId';

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function getSessionsMap() {
    const { [SESSIONS_KEY]: map = {} } = await chrome.storage.local.get(SESSIONS_KEY);
    return map && typeof map === 'object' ? map : {};
  }

  async function getSegmentsMap() {
    const { [SEGMENTS_KEY]: map = {} } = await chrome.storage.local.get(SEGMENTS_KEY);
    return map && typeof map === 'object' ? map : {};
  }

  async function getTabSessionIndex() {
    const { [TAB_SESSION_INDEX_KEY]: index = {} } = await chrome.storage.local.get(TAB_SESSION_INDEX_KEY);
    return index && typeof index === 'object' ? index : {};
  }

  async function getTabSegmentIndex() {
    const { [TAB_SEGMENT_INDEX_KEY]: index = {} } = await chrome.storage.local.get(TAB_SEGMENT_INDEX_KEY);
    return index && typeof index === 'object' ? index : {};
  }

  async function saveSessionsMap(map) {
    await chrome.storage.local.set({ [SESSIONS_KEY]: map });
  }

  async function saveSegmentsMap(map) {
    await chrome.storage.local.set({ [SEGMENTS_KEY]: map });
  }

  async function saveTabSessionIndex(index) {
    await chrome.storage.local.set({ [TAB_SESSION_INDEX_KEY]: index });
  }

  async function saveTabSegmentIndex(index) {
    await chrome.storage.local.set({ [TAB_SEGMENT_INDEX_KEY]: index });
  }

  async function listSessions() {
    const map = await getSessionsMap();
    return Object.values(map);
  }

  async function listActiveSessions() {
    return SessionMatching.activeSessionsFilter(await listSessions());
  }

  async function getSession(sessionId) {
    if (!sessionId) return null;
    const map = await getSessionsMap();
    return map[sessionId] || null;
  }

  async function getSessionByJobId(jobId) {
    const key = String(jobId || '').trim();
    if (!key) return null;
    const sessions = await listSessions();
    const active = sessions
      .filter((s) => String(s.jobId) === key && s.status !== 'completed' && s.status !== 'discarded')
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return active[0] || null;
  }

  async function getSegment(segmentId) {
    if (!segmentId) return null;
    const map = await getSegmentsMap();
    return map[segmentId] || null;
  }

  async function getSegmentByTabId(tabId) {
    if (tabId == null) return null;
    const index = await getTabSegmentIndex();
    const segmentId = index[String(tabId)];
    if (!segmentId) return null;
    return getSegment(segmentId);
  }

  async function getSessionByTabId(tabId) {
    if (tabId == null) return null;
    const index = await getTabSessionIndex();
    const sessionId = index[String(tabId)];
    if (sessionId) return getSession(sessionId);
    const segment = await getSegmentByTabId(tabId);
    if (segment?.sessionId) return getSession(segment.sessionId);
    return null;
  }

  async function linkTab(sessionId, tabId) {
    if (!sessionId || tabId == null) return;
    const index = await getTabSessionIndex();
    index[String(tabId)] = sessionId;
    await saveTabSessionIndex(index);
  }

  async function unlinkTab(tabId) {
    if (tabId == null) return;
    const index = await getTabSessionIndex();
    if (!index[String(tabId)]) return;
    delete index[String(tabId)];
    await saveTabSessionIndex(index);
  }

  async function linkSegmentTab(segmentId, tabId) {
    if (!segmentId || tabId == null) return;
    const index = await getTabSegmentIndex();
    index[String(tabId)] = segmentId;
    await saveTabSegmentIndex(index);
  }

  async function unlinkSegmentTab(tabId) {
    if (tabId == null) return;
    const index = await getTabSegmentIndex();
    if (!index[String(tabId)]) return;
    delete index[String(tabId)];
    await saveTabSegmentIndex(index);
  }

  async function upsertSession(sessionId, partial) {
    const map = await getSessionsMap();
    const prev = map[sessionId] || {};
    const next = {
      ...prev,
      ...partial,
      sessionId,
      updatedAt: nowIso(),
      createdAt: prev.createdAt || partial.createdAt || nowIso(),
      activeTabIds: partial.activeTabIds !== undefined ? partial.activeTabIds : prev.activeTabIds || [],
      recordingSegmentIds:
        partial.recordingSegmentIds !== undefined
          ? partial.recordingSegmentIds
          : prev.recordingSegmentIds || [],
    };
    map[sessionId] = next;
    await saveSessionsMap(map);
    return next;
  }

  async function upsertSegment(segmentId, partial) {
    const map = await getSegmentsMap();
    const prev = map[segmentId] || {};
    const next = {
      ...prev,
      ...partial,
      segmentId,
    };
    map[segmentId] = next;
    await saveSegmentsMap(map);
    if (next.tabId != null) {
      await linkSegmentTab(segmentId, next.tabId);
    }
    return next;
  }

  /**
   * Create a new application session for a job apply.
   */
  async function createSession({
    jobId,
    jobTitle,
    companyName,
    originalJobUrl,
    tabId = null,
    poolId = null,
    athensJobId = null,
  }) {
    const sessionId = makeId('appsess');
    const originalDomain = SessionMatching.extractDomain(originalJobUrl);
    const session = {
      sessionId,
      jobId: String(jobId),
      athensJobId: String(athensJobId || jobId),
      poolId: poolId || null,
      jobTitle: jobTitle || '',
      companyName: companyName || '',
      originalJobUrl: originalJobUrl || '',
      originalDomain,
      status: 'recording',
      activeTabIds: tabId != null ? [tabId] : [],
      recordingSegmentIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      warning: null,
    };
    await upsertSession(sessionId, session);
    if (tabId != null) await linkTab(sessionId, tabId);
    return session;
  }

  async function createSegment({
    sessionId = null,
    tabId,
    openerTabId = null,
    url = '',
    status = 'recording',
  }) {
    const segmentId = makeId('seg');
    const domain = SessionMatching.extractDomain(url);
    const segment = {
      segmentId,
      sessionId,
      tabId,
      openerTabId,
      url: url || '',
      domain,
      startedAt: nowIso(),
      endedAt: null,
      status,
      videoBlobKey: segmentId,
      closeReason: null,
      mimeType: null,
      videoFormat: null,
      videoSizeBytes: null,
      error: null,
    };
    await upsertSegment(segmentId, segment);

    if (sessionId) {
      const session = await getSession(sessionId);
      if (session) {
        const merged = SessionMatching.mergeSegmentIntoSession(session, segment);
        await upsertSession(sessionId, merged);
        if (tabId != null) await linkTab(sessionId, tabId);
      }
    }

    return segment;
  }

  async function attachSegmentToSession(segmentId, sessionId) {
    const segment = await getSegment(segmentId);
    const session = await getSession(sessionId);
    if (!segment || !session) throw new Error('Segment or session not found.');

    const updatedSegment = await upsertSegment(segmentId, {
      sessionId,
      status: 'merged',
      endedAt: segment.endedAt || nowIso(),
    });

    const merged = SessionMatching.mergeSegmentIntoSession(session, updatedSegment);
    // Clear needs_merge if no other unassigned pending for this flow
    const allSegments = await getSegmentsMap();
    const stillUnassigned = Object.values(allSegments).some(
      (s) => s.status === 'unassigned' && s.segmentId !== segmentId,
    );
    const nextStatus = stillUnassigned ? 'needs_merge' : 'recording';
    await upsertSession(sessionId, { ...merged, status: nextStatus });

    if (updatedSegment.tabId != null) {
      await linkTab(sessionId, updatedSegment.tabId);
    }

    return { segment: updatedSegment, session: await getSession(sessionId) };
  }

  async function discardSegment(segmentId) {
    const segment = await getSegment(segmentId);
    if (!segment) return null;
    const updated = await upsertSegment(segmentId, {
      status: 'discarded',
      endedAt: segment.endedAt || nowIso(),
      closeReason: segment.closeReason || 'discarded',
    });
    if (segment.tabId != null) {
      await unlinkSegmentTab(segment.tabId);
    }
    return updated;
  }

  async function markSegmentEnded(segmentId, { closeReason = 'tab_closed', status } = {}) {
    const segment = await getSegment(segmentId);
    if (!segment) return null;
    const nextStatus =
      status ||
      (segment.status === 'unassigned'
        ? 'unassigned'
        : segment.sessionId
          ? 'merged'
          : 'unassigned');
    return upsertSegment(segmentId, {
      status: nextStatus,
      endedAt: nowIso(),
      closeReason,
    });
  }

  async function removeTabFromSession(sessionId, tabId) {
    const session = await getSession(sessionId);
    if (!session) return null;
    const activeTabIds = (session.activeTabIds || []).filter((id) => Number(id) !== Number(tabId));
    await unlinkTab(tabId);
    return upsertSession(sessionId, { activeTabIds });
  }

  async function completeSession(sessionId) {
    return upsertSession(sessionId, {
      status: 'completed',
      completedAt: nowIso(),
      activeTabIds: [],
    });
  }

  async function discardSession(sessionId) {
    return upsertSession(sessionId, {
      status: 'discarded',
      completedAt: nowIso(),
      activeTabIds: [],
    });
  }

  async function getSegmentsForSession(sessionId) {
    if (!sessionId) return [];
    const map = await getSegmentsMap();
    return Object.values(map).filter((s) => s.sessionId === sessionId);
  }

  async function getUnassignedSegments() {
    const map = await getSegmentsMap();
    return Object.values(map).filter((s) => s.status === 'unassigned' && !s.sessionId);
  }

  async function setPendingMerge(segmentId) {
    await chrome.storage.local.set({ [PENDING_MERGE_KEY]: segmentId || null });
  }

  async function getPendingMerge() {
    const { [PENDING_MERGE_KEY]: id = null } = await chrome.storage.local.get(PENDING_MERGE_KEY);
    if (!id) return null;
    return getSegment(id);
  }

  async function clearPendingMerge() {
    await chrome.storage.local.set({ [PENDING_MERGE_KEY]: null });
  }

  async function setPendingFinishPrompt(sessionId) {
    await chrome.storage.local.set({ [PENDING_FINISH_PROMPT_KEY]: sessionId || null });
  }

  async function getPendingFinishPrompt() {
    const { [PENDING_FINISH_PROMPT_KEY]: id = null } = await chrome.storage.local.get(
      PENDING_FINISH_PROMPT_KEY,
    );
    if (!id) return null;
    return getSession(id);
  }

  async function clearPendingFinishPrompt() {
    await chrome.storage.local.set({ [PENDING_FINISH_PROMPT_KEY]: null });
  }

  async function removeSessionAndSegments(sessionId) {
    const session = await getSession(sessionId);
    if (!session) return;
    const map = await getSegmentsMap();
    for (const segId of session.recordingSegmentIds || []) {
      const seg = map[segId];
      if (seg?.tabId != null) await unlinkSegmentTab(seg.tabId);
      delete map[segId];
    }
    await saveSegmentsMap(map);
    for (const tabId of session.activeTabIds || []) {
      await unlinkTab(tabId);
    }
    const sessions = await getSessionsMap();
    delete sessions[sessionId];
    await saveSessionsMap(sessions);
  }

  /**
   * Snapshot for side panel / recovery UI.
   */
  async function getUiSnapshot(focusedTabId = null) {
    const sessions = await listActiveSessions();
    const allSegments = await getSegmentsMap();
    const unassigned = Object.values(allSegments).filter((s) => s.status === 'unassigned');
    const pendingMerge = await getPendingMerge();
    const pendingFinish = await getPendingFinishPrompt();

    const cards = sessions.map((session) => {
      const segs = (session.recordingSegmentIds || [])
        .map((id) => allSegments[id])
        .filter(Boolean);
      const live =
        focusedTabId != null &&
        (session.activeTabIds || []).map(Number).includes(Number(focusedTabId));
      const isLiveRecording = (session.activeTabIds || []).some(
        (tid) =>
          typeof SessionRecorder !== 'undefined' &&
          Boolean(SessionRecorder.getSessionIdForTab(Number(tid))),
      );
      const clipCount = segs.filter(
        (s) =>
          Number(s.videoSizeBytes) > 0 ||
          (s.tabId != null &&
            typeof SessionRecorder !== 'undefined' &&
            Boolean(SessionRecorder.getSessionIdForTab(Number(s.tabId)))),
      ).length;
      const hasFailed = segs.some((s) => s.status === 'failed');
      const displayStatus = isLiveRecording
        ? 'recording'
        : session.status === 'recording'
          ? 'ready'
          : session.status;
      return {
        ...session,
        segmentCount: clipCount,
        humanStatus: SessionMatching.humanStatus(displayStatus),
        isLiveTab: live,
        isLiveRecording,
        needsMerge: session.status === 'needs_merge' || unassigned.length > 0,
        hasFailedSegment: hasFailed,
        warning:
          session.warning ||
          (hasFailed
            ? 'A clip failed — click the Bid Monitor toolbar icon on that tab.'
            : null),
      };
    });

    return {
      sessions: cards,
      unassignedSegments: unassigned,
      pendingMergeSegment: pendingMerge,
      pendingFinishSession: pendingFinish,
      needsMergeBadge: unassigned.length > 0 || sessions.some((s) => s.status === 'needs_merge'),
    };
  }

  return {
    SESSIONS_KEY,
    SEGMENTS_KEY,
    createSession,
    createSegment,
    getSession,
    getSegment,
    getSessionByJobId,
    getSessionByTabId,
    getSegmentByTabId,
    listSessions,
    listActiveSessions,
    upsertSession,
    upsertSegment,
    attachSegmentToSession,
    discardSegment,
    markSegmentEnded,
    removeTabFromSession,
    completeSession,
    discardSession,
    getSegmentsForSession,
    getUnassignedSegments,
    setPendingMerge,
    getPendingMerge,
    clearPendingMerge,
    setPendingFinishPrompt,
    getPendingFinishPrompt,
    clearPendingFinishPrompt,
    removeSessionAndSegments,
    getUiSnapshot,
    linkTab,
    unlinkTab,
    unlinkSegmentTab,
    getTabSessionIndex,
  };
})();

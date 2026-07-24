importScripts(
  chrome.runtime.getURL('config.js'),
  'video-format.js',
  'session-matching.js',
  'segment-stitch.js',
  'video-store.js',
  'session-recorder.js',
  'canonical-resume-name.js',
  'athens-api.js',
  'auth-session.js',
  'queue-sync.js',
  'apply-lifecycle.js',
  'application-session.js',
  'segment-lifecycle.js',
  'mock-api.js',
  'zip-utils.js',
  'page-context.js',
);

const STORAGE_KEY = 'bidMonitorSessions';

/** @deprecated Prefer ApplyLifecycle — kept as tab-shaped compatibility helpers. */
async function getPendingApplyTabs() {
  return ApplyLifecycle.toPendingTabsShape();
}

async function setPendingApply(tabId, data) {
  if (!tabId) return;
  await ApplyLifecycle.setPendingForTab(tabId, data);
}

async function clearPendingApply(tabId) {
  if (!tabId) return;
  await ApplyLifecycle.clearPendingForTab(tabId);
}

async function clearApplySessionByJobId(jobId) {
  if (!jobId) return;
  const appSession = await ApplicationSessionStore.getSessionByJobId(jobId);
  if (appSession) {
    await ApplicationSessionStore.removeSessionAndSegments(appSession.sessionId).catch(() => {});
  }
  await ApplyLifecycle.remove(jobId);
}

async function markApplyRecording(tabId, recorderStatus = 'recording') {
  const apply = await ApplyLifecycle.getByTabId(tabId);
  if (!apply) return;
  await ApplyLifecycle.upsert(apply.jobId, {
    recorderStatus,
    error: null,
    applyTabId: tabId,
  });
}

async function getSessions() {
  const { [STORAGE_KEY]: sessions = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return sessions;
}

async function saveSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
}

async function getRecordingSessions() {
  const sessions = await getSessions();
  return sessions.filter((s) => s.status === 'recording');
}

async function getSessionForTab(tabId) {
  if (!tabId) return null;
  const sessions = await getRecordingSessions();
  return sessions.find((s) => s.tabId === tabId) ?? null;
}

let badgedTabIds = new Set();

async function updateNeedsMergeBadge() {
  const waitingCount = await ApplicationSessionStore.getWaitingClipCount();
  const active = await getRecordingSessions();
  const hasLiveRec = active.some((s) => s.tabId != null);

  // Prefer per-tab REC badges while recording; otherwise show waiting count.
  if (hasLiveRec) {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    return waitingCount;
  }

  if (waitingCount > 0) {
    chrome.action.setBadgeText({ text: String(Math.min(waitingCount, 9)) }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#d97706' }).catch(() => {});
    chrome.action
      .setTitle({
        title:
          waitingCount === 1
            ? 'Bid Monitor: 1 recording waiting — open to attach or dismiss'
            : `Bid Monitor: ${waitingCount} recordings waiting — open to attach or dismiss`,
      })
      .catch(() => {});
  } else {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    chrome.action.setTitle({ title: 'Bid Monitor' }).catch(() => {});
  }
  return waitingCount;
}

async function updateRecordingBadge() {
  const active = await getRecordingSessions();
  const activeTabIds = new Set(active.map((s) => s.tabId).filter((id) => id != null));

  // Show REC only on tabs that are actually recording.
  for (const tabId of activeTabIds) {
    chrome.action.setBadgeText({ tabId, text: 'REC' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' }).catch(() => {});
  }

  // Clear REC from tabs that stopped recording since last update.
  for (const tabId of badgedTabIds) {
    if (!activeTabIds.has(tabId)) {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }
  }

  badgedTabIds = activeTabIds;

  // Global badge shows waiting clips when nothing is actively recording.
  await updateNeedsMergeBadge();
}

async function ensureTabScriptsReady(tabId) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING_CONTENT' });
      if (pong?.ok) return true;
    } catch {
      // Content script not ready yet.
    }

    if (attempt === 0 || attempt % 5 === 4) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        files: ['content/resume-file-tracking.js', 'content/page-hook.js'],
      }).catch(() => {});
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content/content.js'],
      }).catch(() => {});
    }

    await sleep(250);
  }

  return false;
}

async function notifyTabWithRetry(tabId, message, maxAttempts = 25) {
  if (!tabId) return null;

  await ensureTabScriptsReady(tabId);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      await sleep(200);
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content/content.js'],
  }).catch(() => {});

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__bidMonitorResync === 'function') {
          window.__bidMonitorResync();
        }
      },
    });
  } catch {
    // Content script may not be ready yet.
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function notifyTab(tabId, extra = {}, options = {}) {
  if (!tabId) return;

  const message = { type: 'SESSION_UPDATED', ...extra };
  if (options.retry) {
    await notifyTabWithRetry(tabId, message);
    return;
  }

  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function notifyAllRecordingTabs() {
  const sessions = await getRecordingSessions();
  for (const session of sessions) {
    if (session.tabId) {
      await notifyTab(session.tabId, {
        isRecording: true,
        recorderStatus: session.recorderStatus ?? 'recording',
      });
    }
  }
}

async function syncStoredRecorderStatuses(windowId, activeTabId) {
  const sessions = await getRecordingSessions();
  for (const session of sessions) {
    if (session.recordingWindowId !== windowId) continue;
    const recorderStatus = session.tabId === activeTabId ? 'recording' : 'paused';
    if (session.recorderStatus !== recorderStatus) {
      await updateSession(session.id, { recorderStatus });
      if (session.tabId) {
        await notifyTab(session.tabId, { isRecording: true, recorderStatus });
      }
      if (session.recorderSource === 'sidePanel') {
        chrome.runtime.sendMessage({
          type: 'SIDE_PANEL_SYNC_PAUSE',
          tabId: session.tabId,
          paused: recorderStatus === 'paused',
        }).catch(() => {});
      }
    }
  }
}

async function updateSession(sessionId, updater) {
  const sessions = await getSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return null;

  const updated = typeof updater === 'function' ? updater(sessions[index]) : { ...sessions[index], ...updater };
  sessions[index] = updated;
  await saveSessions(sessions);
  return updated;
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(name) {
  return (name || 'bidder').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

/** Windows-safe download basename — keeps spaces / dashes for canonical names. */
function sanitizeResumeDownloadName(name) {
  let stem = String(name || 'resume')
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/\\:\*\?"<>\|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!stem) stem = 'resume';
  if (stem.length > 180) stem = stem.slice(0, 180).replace(/[. ]+$/g, '') || 'resume';
  return stem;
}

async function downloadBlobAsFile(blob, filename, { saveAs = false } = {}) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs,
    });
  } finally {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 60_000);
  }
}

function videoExtension(mimeType, videoFormat) {
  if (mimeType) return VideoFormat.extensionForMimeType(mimeType);
  return videoFormat === 'mp4' ? 'mp4' : 'webm';
}

/**
 * Local video download is disabled — recordings are uploaded to Firebase only.
 * Kept as a no-op so any stale caller cannot open Chrome's Save dialog.
 */
async function downloadVideoFromStore(_sessionId, _filename) {
  console.info('Bid Monitor: local video download skipped (Firebase upload only).');
}

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Download recorded session video',
    });
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' });
      if (response?.ok) return;
    } catch {
      // offscreen not ready yet
    }
    await sleep(100);
  }
}

/** Local session export disabled — use Bid Management / Firebase for recordings. */
async function downloadSessionFiles(_session, _options = {}) {
  console.info('Bid Monitor: local session export skipped (Firebase upload only).');
}

function updateBadge(isRecording) {
  if (isRecording) {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function abandonStoredSession(sessionId) {
  await updateSession(sessionId, (session) => ({
    ...session,
    status: 'completed',
    stoppedAt: new Date().toISOString(),
    recorderStatus: 'stopped',
    abandoned: true,
  }));
}

async function cleanupOrphanRecordingSessions() {
  const recordingSessions = await getRecordingSessions();

  for (const session of recordingSessions) {
    if (!session.tabId || !(await tabExists(session.tabId))) {
      try {
        await SessionRecorder.stop(session.id);
      } catch {
        // Offscreen recorder may already be gone.
      }
      await abandonStoredSession(session.id);
    }
  }

  await SessionRecorder.pruneStaleTabSessions();
  await updateRecordingBadge();
}

async function cleanupStoredSessionForClosedTab(tabId) {
  // SegmentLifecycle owns multi-tab segment stop + merge prompts.
  // Keep legacy bidMonitorSessions cleanup for non-segment recordings.
  const segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
  if (segment) {
    // SegmentLifecycle.handleTabRemoved owns stopping and persisting the
    // segment recorder. Remove the compatibility bidMonitorSessions row here
    // without stopping the recorder a second time, otherwise the mirrored
    // session remains permanently "recording" and accumulates in storage.
    const legacySession = await getSessionForTab(tabId);
    if (legacySession) {
      const sessions = await getSessions();
      await saveSessions(sessions.filter((session) => session.id !== legacySession.id));
    }
    await updateRecordingBadge();
    broadcastApplySessionUpdate(tabId);
    return;
  }

  const session = await getSessionForTab(tabId);
  if (session) {
    // If this recording is tied to an application session with other tabs, don't abandon video.
    const appSession = session.jobId
      ? await ApplicationSessionStore.getSessionByJobId(session.jobId)
      : null;
    if (appSession && (appSession.activeTabIds || []).some((id) => Number(id) !== Number(tabId))) {
      try {
        await SessionRecorder.stop(session.id);
      } catch {
        // ignore
      }
      await abandonStoredSession(session.id);
      await ApplyLifecycle.clearApplyTabOnly(tabId);
    } else {
      await abandonStoredSession(session.id);
      if (session.jobId) {
        await ApplyLifecycle.upsert(session.jobId, {
          applyTabId: null,
          recorderStatus: 'ready',
        });
      }
    }
  } else {
    await ApplyLifecycle.clearApplyTabOnly(tabId);
  }
  await updateRecordingBadge();
  broadcastApplySessionUpdate(tabId);
}

function isCapturableUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function isBlockedCaptureUrl(url) {
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url || '');
}

function formatTabCaptureError(message) {
  const text = String(message || '');
  if (text.includes('has not been invoked')) {
    return 'Tab capture was denied. Wait for the job page to load, then click Start Recording in the side panel.';
  }
  if (text.includes('Chrome pages cannot be captured')) {
    return 'Cannot record this page. Click Apply to open the job application site first.';
  }
  return text || 'Failed to start tab capture.';
}

async function resolvePendingApplyTabId(_pendingAll = null) {
  const apply = await ApplyLifecycle.resolveActiveApply();
  if (apply?.applyTabId != null) {
    try {
      await chrome.tabs.get(apply.applyTabId);
      return apply.applyTabId;
    } catch {
      await ApplyLifecycle.upsert(apply.jobId, { applyTabId: null });
    }
  }
  return null;
}

async function assertCapturableApplyTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (isBlockedCaptureUrl(tab.url)) {
    throw new Error(formatTabCaptureError('Chrome pages cannot be captured'));
  }
  if (!isCapturableUrl(tab.url)) {
    throw new Error(
      `Job page not ready (${tab.url || 'still loading'}). Wait until the application form appears, then click Start Recording.`,
    );
  }
  return tab;
}

async function captureTabStreamIdEarly(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!streamId) {
        reject(new Error('tabCapture returned an empty stream id.'));
        return;
      }
      resolve(streamId);
    });
  });
}

async function captureTabStreamId(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isCapturableUrl(tab.url)) {
    throw new Error(`Page not ready for capture (${tab.url || 'loading'}).`);
  }

  await chrome.tabs.update(tabId, { active: true });
  await sleep(200);

  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!streamId) {
            reject(new Error('tabCapture returned an empty stream id.'));
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
        message.includes('not ready') ||
        message.includes('Chrome pages cannot be captured');

      if (!retriable || attempt === maxAttempts - 1) {
        if (message.includes('has not been invoked') || message.includes('Chrome pages cannot be captured')) {
          throw new Error(formatTabCaptureError(message));
        }
        throw err;
      }

      await sleep(500);
    }
  }

  throw new Error('Failed to obtain tab capture stream.');
}

async function waitForCapturableTab(tabId, timeoutMs = 30000) {
  const start = Date.now();
  let lastUrl = '';
  let capturableStreak = 0;

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    lastUrl = tab.url || '';

    if (isCapturableUrl(tab.url)) {
      capturableStreak += 1;
      if (tab.status === 'complete' || capturableStreak >= 3) {
        return tab;
      }
    } else {
      capturableStreak = 0;
    }

    await sleep(300);
  }

  const tab = await chrome.tabs.get(tabId);
  if (isCapturableUrl(tab.url)) return tab;

  if (String(tab.url || '').startsWith('chrome')) {
    throw new Error('The job page could not be loaded for recording. Chrome internal pages cannot be captured.');
  }

  throw new Error(`Timed out waiting for the job page to load (${lastUrl || 'no URL'}).`);
}

async function prepareTabForCapture(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await sleep(400);
  return chrome.tabs.get(tab.id);
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Job page load timed out.'));
    }, timeoutMs);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        resolve();
        return;
      }
      chrome.tabs.onUpdated.addListener(listener);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function notifyRecordingFailed(tabId, { profileName, job, error }) {
  if (!tabId) return;

  await setPendingApply(tabId, {
    profileName,
    recorderStatus: 'error',
    error: error || 'Recording failed to start.',
    job,
  });

  await notifyTabWithRetry(tabId, {
    type: 'APPLY_STARTED',
    profileName,
    recorderStatus: 'error',
    error: error || 'Recording failed to start.',
    session: {
      resumeSetFolder: job?.resumeFolderName,
      applyFlow: true,
    },
    job,
  });
}

async function notifyApplyPanel(tabId, payload) {
  if (!tabId) return;
  await ensureTabScriptsReady(tabId).catch(() => {});
  await notifyTabWithRetry(tabId, {
    type: 'APPLY_STARTED',
    ...payload,
  });
}

async function openApplyOnTab(tabId, poolId, jobId, streamId = null) {
  const { auth, pool, job } = await resolveApplyJob({ poolId, jobId });
  const jobPayload = {
    id: job.id,
    athensJobId: job.athensJobId || job.id,
    companyName: job.companyName,
    title: job.title,
    jdUrl: job.jdUrl,
    resumeFolderName: job.resumeFolderName,
    expectedResumeName: job.expectedResumeName || null,
    hasGeneratedResume: Boolean(job.hasGeneratedResume),
  };

  await cleanupOrphanRecordingSessions();

  // Reopening an in-process job (its ApplicationSession already exists) must NOT
  // re-run the Athens start — that would double-start the bid. Only start the
  // bid the first time Apply is used for this job.
  const existingAppSession = await ApplicationSessionStore.getSessionByJobId(job.id);
  const isResume = Boolean(existingAppSession);

  // Mark Athens Bid Ready job as in-process — fail Apply if this fails.
  if ((pool.source === 'athens' || pool.id === 'athens-bid-ready') && !isResume) {
    const settings = await AthensApi.getSettings();
    const applierName = settings.applierName || auth.applierName || auth.displayName;
    if (!applierName || !job.id) {
      throw new Error('Athens applier name and job id are required to start a bid.');
    }
    await AthensApi.startBid(applierName, {
      jobId: job.athensJobId || job.id,
      bidderName: auth.displayName,
      applyUrl: job.jdUrl,
    });
    await QueueSync.patchJobStatus(job.athensJobId || job.id, 'in_process');
  }

  await ApplyLifecycle.upsert(job.id, {
    athensJobId: jobPayload.athensJobId,
    poolId: pool.id,
    job: jobPayload,
    bidderName: auth.displayName,
    profileName: auth.displayName,
    athensStatus: 'in_process',
    recorderStatus: 'ready',
    applyTabId: tabId,
    streamId,
    streamIdCapturedAt: streamId ? new Date().toISOString() : null,
    error: null,
  });

  // Create ApplicationSession + first segment (multi-tab recording parent).
  let appSessionResult = null;
  try {
    appSessionResult = await SegmentLifecycle.onApplyOpened({
      jobId: job.id,
      jobTitle: job.title,
      companyName: job.companyName,
      originalJobUrl: job.jdUrl,
      tabId,
      poolId: pool.id,
      athensJobId: jobPayload.athensJobId,
      streamId: null, // capture starts after wait / via applyToJob streamId path
    });
  } catch (err) {
    console.warn('Bid Monitor: application session create failed', err);
  }

  await notifyApplyPanel(tabId, {
    profileName: auth.displayName,
    recorderStatus: 'ready',
    session: {
      resumeSetFolder: job.resumeFolderName,
      applyFlow: true,
      pending: true,
      applicationSessionId: appSessionResult?.session?.sessionId || null,
    },
    job: jobPayload,
  });

  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel/panel.html',
      enabled: true,
    });
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.warn('Bid Monitor: could not open side panel', err);
  }

  chrome.runtime.sendMessage({ type: 'APPLY_SESSION_UPDATED', tabId, jobId: job.id }).catch(() => {});

  return { ok: true, tabId, job: jobPayload, recorderStatus: 'ready' };
}

function broadcastApplySessionUpdate(tabId) {
  chrome.runtime.sendMessage({ type: 'APPLY_SESSION_UPDATED', tabId }).catch(() => {});
}

async function captureStreamIdInServiceWorker(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!streamId) {
        reject(new Error('tabCapture returned an empty stream id.'));
        return;
      }
      resolve(streamId);
    });
  });
}

async function applyToJob(poolId, jobId, jobUrl) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: jobUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to open job tab.'));
        return;
      }

      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
        (async () => {
          try {
            const result = await openApplyOnTab(tab.id, poolId, jobId, streamId || null);

            if (!streamId) {
              resolve(result);
              return;
            }

            try {
              const started = await startApplyRecording(tab.id, {
                streamId,
                recordInTab: false,
                skipCapturableCheck: true,
              });
              resolve({
                ...result,
                autoStarted: true,
                fallbackUsed: started.recording?.fallbackUsed ?? false,
              });
            } catch (startErr) {
              const pendingAll = await getPendingApplyTabs();
              const pending = pendingAll[tab.id];
              if (pending?.job) {
                await setPendingApply(tab.id, {
                  ...pending,
                  recorderStatus: 'ready',
                  error: formatTabCaptureError(startErr.message),
                  streamId,
                });
                await notifyApplyPanel(tab.id, {
                  profileName: pending.profileName,
                  recorderStatus: 'ready',
                  error: formatTabCaptureError(startErr.message),
                  session: {
                    resumeSetFolder: pending.job.resumeFolderName,
                    applyFlow: true,
                    pending: true,
                  },
                  job: pending.job,
                });
              }
              resolve({
                ...result,
                autoStarted: false,
                recordingError: formatTabCaptureError(startErr.message),
              });
            }
          } catch (err) {
            reject(err);
          }
        })();
      });
    });
  });
}

async function handleStartApplyRecording(message, sender, sendResponse) {
  const beginCapture = (tabId) => {
    if (!tabId) {
      sendResponse({ ok: false, error: 'No job tab found. Click Apply on a job first.' });
      return;
    }

    const runStart = async (streamId) => {
      try {
        const started = await startApplyRecording(tabId, {
          streamId,
          recordInTab: false,
        });
        sendResponse({
          ok: true,
          fallbackUsed: started.recording?.fallbackUsed ?? false,
        });
        broadcastApplySessionUpdate(tabId);
      } catch (err) {
        const pending = (await getPendingApplyTabs())[tabId];
        if (pending?.job) {
          await notifyRecordingFailed(tabId, {
            profileName: pending.profileName ?? '',
            job: pending.job,
            error: formatTabCaptureError(err.message),
          });
        }
        broadcastApplySessionUpdate(tabId);
        sendResponse({ ok: false, error: formatTabCaptureError(err.message) });
      }
    };

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      void runStart(streamId || message.streamId || null);
    });
  };

  const tabId = message.tabId ?? sender.tab?.id;
  if (tabId) {
    beginCapture(tabId);
    return;
  }

  const resolvedTabId = await resolvePendingApplyTabId();
  beginCapture(resolvedTabId);
}

async function finishApplyToJobTab(tab, message, streamId, sendResponse) {
  try {
    const result = await openApplyOnTab(
      tab.id,
      message.poolId,
      message.jobId,
      streamId || null,
    );

    if (!streamId) {
      sendResponse({
        ...result,
        autoStarted: false,
        recordingError:
          'Recording did not start automatically. Focus the job tab and click the Bid Monitor toolbar icon.',
      });
      return;
    }

    try {
      const started = await startApplyRecording(tab.id, {
        streamId,
        recordInTab: false,
        skipCapturableCheck: true,
      });
      sendResponse({
        ...result,
        autoStarted: true,
        fallbackUsed: started.recording?.fallbackUsed ?? false,
      });
    } catch (startErr) {
      const pendingAll = await getPendingApplyTabs();
      const pending = pendingAll[tab.id];
      if (pending?.job) {
        await setPendingApply(tab.id, {
          ...pending,
          recorderStatus: 'ready',
          error: formatTabCaptureError(startErr.message),
          streamId,
        });
        await notifyApplyPanel(tab.id, {
          profileName: pending.profileName,
          recorderStatus: 'ready',
          error: formatTabCaptureError(startErr.message),
          session: {
            resumeSetFolder: pending.job.resumeFolderName,
            applyFlow: true,
            pending: true,
          },
          job: pending.job,
        });
      }
      sendResponse({
        ...result,
        autoStarted: false,
        recordingError: formatTabCaptureError(startErr.message),
      });
    }
  } catch (err) {
    sendResponse({ ok: false, error: formatTabCaptureError(err.message) });
  }
}

function handleApplyToJob(message, sendResponse) {
  // Preferred path: side panel / popup already created the tab and captured
  // streamId inside the user-gesture click (required by Chrome tabCapture).
  if (message.tabId != null) {
    chrome.tabs.get(Number(message.tabId), (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError?.message || 'Failed to open job tab.',
        });
        return;
      }
      void finishApplyToJobTab(tab, message, message.streamId || null, sendResponse);
    });
    return;
  }

  chrome.tabs.create({ url: message.jobUrl, active: true }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Failed to open job tab.' });
      return;
    }

    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
      void finishApplyToJobTab(tab, message, streamId || null, sendResponse);
    });
  });
}

async function startApplyRecording(tabId, options = {}) {
  const skipCapturableCheck = Boolean(options.skipCapturableCheck);
  const streamIdFromClient = options.streamId ?? null;
  const pendingAll = await getPendingApplyTabs();
  const pending = pendingAll[tabId];
  if (!pending?.job) {
    throw new Error('No application session for this tab. Click Apply in the Bid Monitor side panel first.');
  }

  if (!skipCapturableCheck) {
    await assertCapturableApplyTab(tabId);
  }

  const streamIdFromPending = pending.streamId ?? null;
  const recordInTab = Boolean(
    options.recordInTab && (streamIdFromClient || streamIdFromPending),
  );
  let streamId = streamIdFromClient ?? streamIdFromPending ?? null;

  const auth = await MockApi.getAuth();
  if (!auth || auth.role !== 'bidder') {
    throw new Error('Sign in as a bidder to record.');
  }

  const existing = await getSessionForTab(tabId);
  if (existing) {
    throw new Error('This tab is already being recorded.');
  }

  await setPendingApply(tabId, {
    ...pending,
    recorderStatus: 'starting',
    error: null,
  });

  await notifyApplyPanel(tabId, {
    profileName: pending.profileName ?? auth.displayName,
    recorderStatus: 'starting',
    session: {
      resumeSetFolder: pending.job.resumeFolderName,
      applyFlow: true,
    },
    job: pending.job,
  });

  let tabState;

  if (streamId && !recordInTab) {
    tabState = await chrome.tabs.get(tabId);
  } else if (recordInTab && streamId) {
    tabState = await chrome.tabs.get(tabId);
    if (!isCapturableUrl(tabState.url)) {
      tabState = await waitForCapturableTab(tabId, 8000);
    }
    await ensureTabScriptsReady(tabId);
  } else if (!streamId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isCapturableUrl(tab.url)) {
        streamId = await captureTabStreamIdEarly(tabId);
      }
    } catch {
      // Retry after the page is ready.
    }

    if (!streamId) {
      tabState = await prepareTabForCapture(await waitForCapturableTab(tabId, 12000));
      streamId = await captureTabStreamId(tabState.id);
    } else {
      tabState = await prepareTabForCapture(await chrome.tabs.get(tabId));
    }
  } else {
    tabState = await prepareTabForCapture(await chrome.tabs.get(tabId));
  }

  const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');

  // Prefer multi-tab ApplicationSession segment capture when available.
  let appSession = await ApplicationSessionStore.getSessionByJobId(pending.job.id);
  if (!appSession) {
    const opened = await SegmentLifecycle.onApplyOpened({
      jobId: pending.job.id,
      jobTitle: pending.job.title,
      companyName: pending.job.companyName,
      originalJobUrl: pending.job.jdUrl,
      tabId,
      poolId: pending.poolId,
      athensJobId: pending.job.athensJobId || pending.job.id,
      streamId: null,
    });
    appSession = opened.session;
  }

  let segment = await ApplicationSessionStore.getSegmentByTabId(tabId);
  if (!segment) {
    segment = await ApplicationSessionStore.createSegment({
      sessionId: appSession.sessionId,
      tabId,
      url: tabState.url || pending.job.jdUrl,
      status: 'recording',
    });
  }

  const capture = await SegmentLifecycle.startSegmentCapture(segment, tabState, {
    streamId,
    videoFormat,
  });

  if (!capture.ok) {
    // Fall back to legacy single-session recorder
    const started = await beginRecordingSession({
      tab: tabState,
      bidderName: auth.displayName,
      resumeSetFolder: pending.job.resumeFolderName,
      videoFormat,
      jobId: pending.job.id,
      poolId: pending.poolId,
      companyName: pending.job.companyName,
      jobTitle: pending.job.title,
      jdUrl: pending.job.jdUrl,
      applyFlow: true,
      streamId,
      recordInTab,
      applicationSessionId: appSession.sessionId,
      segmentId: segment.segmentId,
    });
    await notifyApplyPanel(tabId, {
      profileName: auth.displayName,
      recorderStatus: started.session?.recorderStatus ?? 'recording',
      session: started.session,
      job: pending.job,
    });
    broadcastApplySessionUpdate(tabId);
    return started;
  }

  // Mirror a bidMonitorSessions row for existing UI / badge (keyed by segment id).
  const started = await beginRecordingSession({
    tab: tabState,
    bidderName: auth.displayName,
    resumeSetFolder: pending.job.resumeFolderName,
    videoFormat,
    jobId: pending.job.id,
    poolId: pending.poolId,
    companyName: pending.job.companyName,
    jobTitle: pending.job.title,
    jdUrl: pending.job.jdUrl,
    applyFlow: true,
    streamId,
    recordInTab,
    applicationSessionId: appSession.sessionId,
    segmentId: segment.segmentId,
    skipRecorderStart: true,
    recordingMeta: capture.recording,
  });

  await ApplyLifecycle.upsert(pending.job.id, {
    applicationSessionId: appSession.sessionId,
    recorderStatus: capture.recording?.startedPaused ? 'paused' : 'recording',
  });

  await notifyApplyPanel(tabId, {
    profileName: auth.displayName,
    recorderStatus: started.session?.recorderStatus ?? 'recording',
    session: started.session,
    job: pending.job,
  });

  broadcastApplySessionUpdate(tabId);
  chrome.runtime.sendMessage({ type: 'APPLICATION_SESSIONS_UPDATED' }).catch(() => {});

  return started;
}

async function resolveApplyJob(message) {
  const auth = await MockApi.getAuth();
  if (!auth) {
    throw new Error('Sign in required.');
  }
  if (auth.role !== 'bidder') {
    throw new Error('Only bidders can apply to jobs.');
  }

  let dashboard = await MockApi.getDashboardState({ preferCache: true });
  let pools = dashboard.pools || [];
  let pool = MockApi.findPool(pools, message.poolId);
  let job = MockApi.findJob(pool, message.jobId);
  if (!pool || !job) {
    dashboard = await MockApi.getDashboardState({ preferCache: false, enrichResumes: false });
    pools = dashboard.pools || [];
    pool = MockApi.findPool(pools, message.poolId);
    job = MockApi.findJob(pool, message.jobId);
  }
  if (!pool || !job) {
    throw new Error('Job not found.');
  }
  if (job.status === 'applied') {
    throw new Error('This job is already submitted.');
  }
  if (job.status === 'skipped') {
    throw new Error('This job was skipped.');
  }

  return { auth, pool, job };
}

async function registerSidePanelRecording(tabId, { mimeType, videoFormat, fallbackUsed = false, skipCapturableCheck = false }) {
  const pendingAll = await getPendingApplyTabs();
  const pending = pendingAll[tabId];
  if (!pending?.job) {
    throw new Error('No application session for this tab. Click Apply in the Bid Monitor side panel first.');
  }

  const auth = await MockApi.getAuth();
  if (!auth || auth.role !== 'bidder') {
    throw new Error('Sign in as a bidder to record.');
  }

  const existing = await getSessionForTab(tabId);
  if (existing) {
    throw new Error('This tab is already being recorded.');
  }

  if (!skipCapturableCheck) {
    await assertCapturableApplyTab(tabId);
  }
  const tab = await chrome.tabs.get(tabId);
  const normalizedFormat = VideoFormat.normalizePreference(videoFormat);
  let expectedResumeName = '';
  try {
    expectedResumeName = CanonicalResumeName.buildCanonicalResumeFileName(
      pending.job.companyName,
      pending.job.title,
      auth.displayName,
      pending.job.id,
      '.pdf',
    );
  } catch {
    expectedResumeName = '';
  }

  const session = {
    id: createSessionId(),
    status: 'recording',
    bidderName: auth.displayName,
    resumeSetFolder: pending.job.resumeFolderName,
    expectedResumeName,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    startUrl: tab.url,
    startTitle: tab.title,
    tabId: tab.id,
    recordingWindowId: tab.windowId,
    recorderStatus: 'recording',
    videoFormat: normalizedFormat,
    videoMimeType: mimeType,
    videoSizeBytes: null,
    resumeEvents: [],
    jobId: pending.job.id,
    poolId: pending.poolId,
    companyName: pending.job.companyName,
    jobTitle: pending.job.title,
    jdUrl: pending.job.jdUrl,
    applyFlow: true,
    recorderSource: 'sidePanel',
  };

  const sessions = await getSessions();
  sessions.unshift(session);
  await saveSessions(sessions);
  await markApplyRecording(tab.id, 'recording');
  await updateRecordingBadge();
  await syncStoredRecorderStatuses(tab.windowId, tab.id);
  await notifyTab(tab.id, {
    isRecording: true,
    recorderStatus: 'recording',
    applyFlow: true,
  }, { retry: true });
  await notifyApplyPanel(tab.id, {
    profileName: auth.displayName,
    recorderStatus: 'recording',
    session,
    job: pending.job,
  });
  broadcastApplySessionUpdate(tabId);

  return { session, fallbackUsed };
}

async function beginRecordingSession({
  tab,
  bidderName,
  resumeSetFolder,
  videoFormat,
  jobId = null,
  poolId = null,
  companyName = null,
  jobTitle = null,
  jdUrl = null,
  applyFlow = false,
  streamId = null,
  recordInTab = false,
  applicationSessionId = null,
  segmentId = null,
  skipRecorderStart = false,
  recordingMeta = null,
}) {
  if (!tab?.id) {
    throw new Error('No active tab to record.');
  }

  const existingForTab = await getSessionForTab(tab.id);
  if (existingForTab) {
    throw new Error('This tab already has an active recording.');
  }

  const normalizedFormat = VideoFormat.normalizePreference(videoFormat);
  let expectedResumeName = '';
  try {
    if (companyName && jobTitle && jobId && bidderName) {
      expectedResumeName = CanonicalResumeName.buildCanonicalResumeFileName(
        companyName,
        jobTitle,
        bidderName,
        jobId,
        '.pdf',
      );
    }
  } catch {
    expectedResumeName = '';
  }
  const session = {
    id: segmentId || createSessionId(),
    status: 'recording',
    bidderName: bidderName?.trim() || 'Unknown',
    resumeSetFolder: resumeSetFolder?.trim() || '',
    expectedResumeName,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    startUrl: tab.url,
    startTitle: tab.title,
    tabId: tab.id,
    recordingWindowId: tab.windowId,
    recorderStatus: 'recording',
    videoFormat: normalizedFormat,
    videoMimeType: null,
    videoSizeBytes: null,
    resumeEvents: [],
    jobId,
    poolId,
    companyName,
    jobTitle,
    jdUrl,
    applyFlow,
    applicationSessionId,
    segmentId,
  };

  const sessions = await getSessions();
  sessions.unshift(session);
  await saveSessions(sessions);

  let recording = recordingMeta;
  if (!skipRecorderStart) {
    if (!streamId) {
      throw new Error('Tab capture stream id missing — cannot start recorder.');
    }

    try {
      recording = await SessionRecorder.start(session.id, tab, {
        videoFormat: normalizedFormat,
        streamId,
        recordInTab,
      });
      await updateSession(session.id, {
        videoMimeType: recording.mimeType,
        videoFormat: recording.videoFormat ?? normalizedFormat,
        recordingWindowId: recording.windowId,
        recorderStatus: recording.startedPaused ? 'paused' : 'recording',
      });
    } catch (err) {
      await saveSessions(sessions.filter((s) => s.id !== session.id));
      throw err;
    }
  } else if (recordingMeta) {
    await updateSession(session.id, {
      videoMimeType: recordingMeta.mimeType,
      videoFormat: recordingMeta.videoFormat ?? normalizedFormat,
      recordingWindowId: recordingMeta.windowId ?? tab.windowId,
      recorderStatus: recordingMeta.startedPaused ? 'paused' : 'recording',
    });
  }

  await updateRecordingBadge();
  await markApplyRecording(
    tab.id,
    recording?.startedPaused ? 'paused' : 'recording',
  );
  await syncStoredRecorderStatuses(tab.windowId, tab.id);
  await notifyTab(tab.id, {
    isRecording: true,
    recorderStatus: recording?.startedPaused ? 'paused' : 'recording',
    applyFlow,
  }, { retry: applyFlow });

  return {
    session: (await getSessions()).find((s) => s.id === session.id) ?? session,
    recording,
  };
}

async function finishPendingApplyWithoutRecording({
  tabId,
  closeApplyTab = false,
  finishAction = 'submit',
} = {}) {
  const action = finishAction === 'skip' ? 'skip' : 'submit';
  const apply =
    (tabId != null ? await ApplyLifecycle.getByTabId(tabId) : null) ||
    (await ApplyLifecycle.resolveActiveApply());
  const job = apply?.job;
  if (!job?.id) {
    return { ok: false, error: 'No recording for this tab.' };
  }

  let jobOutcome = null;
  let statusError = null;
  try {
    const auth = await MockApi.getAuth();
    const settings = await AthensApi.getSettings();
    const applierName = settings.applierName || auth?.applierName || auth?.displayName;
    if (!applierName) throw new Error('Athens applier name is required.');

    if (action === 'skip') {
      await AthensApi.skipBid(applierName, {
        jobId: job.id,
        bidderName: auth?.displayName,
      });
      jobOutcome = 'skipped';
    } else {
      await AthensApi.completeBid(applierName, {
        jobId: job.id,
        bidderName: auth?.displayName,
      });
      jobOutcome = 'submitted';
    }
  } catch (err) {
    statusError = err instanceof Error ? err.message : String(err);
  }

  if (closeApplyTab) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  const finishedJobId = job.athensJobId || job.id;
  if (jobOutcome === 'submitted' || jobOutcome === 'skipped') {
    await QueueSync.markJobFinished(
      finishedJobId,
      jobOutcome === 'skipped' ? 'skipped' : 'applied',
      job,
    );
  }
  await clearApplySessionByJobId(job.id);
  await updateRecordingBadge();
  broadcastApplySessionUpdate(tabId);
  await notifyTab(tabId, { isRecording: false });

  if (statusError) {
    return { ok: false, error: statusError, finishAction: action };
  }

  return {
    ok: true,
    session: null,
    downloaded: false,
    finishAction: action,
    jobOutcome,
    jobMarkedApplied: jobOutcome === 'submitted',
    uploaded: false,
    uploadError: null,
    statusError: null,
    recordingPath: null,
    withoutRecording: true,
  };
}

async function completeRecordingSession({
  tabId,
  closeApplyTab = false,
  recordingResult = null,
  /** 'submit' → Bid Management Submitted; 'skip' → Skipped */
  finishAction = 'submit',
  jobId: finishJobId = null,
} = {}) {
  if (!tabId && !finishJobId) {
    return { ok: false, error: 'No tab specified for stop.' };
  }

  const action = finishAction === 'skip' ? 'skip' : 'submit';

  // Resolve application session first (multi-segment path).
  let appSession = null;
  if (finishJobId) {
    appSession = await ApplicationSessionStore.getSessionByJobId(finishJobId);
  }
  if (!appSession && tabId) {
    appSession = await ApplicationSessionStore.getSessionByTabId(tabId);
  }

  const session = tabId ? await getSessionForTab(tabId) : null;
  if (!session && !appSession) {
    return finishPendingApplyWithoutRecording({ tabId, closeApplyTab, finishAction: action });
  }

  const jobId = session?.jobId || appSession?.jobId || finishJobId;
  let stitchWarning = null;
  let stoppedRecording = recordingResult;
  let finalBlob = null;
  let finalMime = 'video/webm';

  if (appSession) {
    try {
      const finalized = await SegmentLifecycle.finalizeSessionVideo(appSession.sessionId);
      finalBlob = finalized.blob;
      finalMime = finalized.mimeType || 'video/webm';
      if (finalized.usedFallback) {
        stitchWarning = 'Used the first clip only — some clips could not be combined.';
      }
      stoppedRecording = {
        mimeType: finalMime,
        videoFormat: finalMime.includes('mp4') ? 'mp4' : 'webm',
        size: finalBlob?.size ?? 0,
      };
      // Persist stitched blob under legacy session id for upload path
      if (finalBlob && session?.id) {
        await SessionVideoStore.save(session.id, finalBlob, {
          mimeType: finalMime,
          videoFormat: stoppedRecording.videoFormat,
        });
      } else if (finalBlob && appSession.sessionId) {
        await SessionVideoStore.save(appSession.sessionId, finalBlob, {
          mimeType: finalMime,
          videoFormat: stoppedRecording.videoFormat,
        });
      }
    } catch (err) {
      console.error('Bid Monitor: finalize session video failed', err);
    }
  }

  if (!stoppedRecording && session) {
    try {
      if (session.recorderSource === 'sidePanel') {
        const entry = await SessionVideoStore.get(session.id);
        stoppedRecording = {
          mimeType: entry?.mimeType ?? session.videoMimeType,
          videoFormat: entry?.videoFormat ?? session.videoFormat,
          size: entry?.blob?.size ?? 0,
        };
      } else {
        stoppedRecording = await SessionRecorder.stop(session.id);
      }
    } catch (err) {
      console.error('Bid Monitor: stop recording failed', err);
    }
  }

  // Stop any remaining live recorders for this job's tabs
  if (appSession) {
    for (const tid of appSession.activeTabIds || []) {
      try {
        const sid = SessionRecorder.getSessionIdForTab(tid);
        if (sid) await SessionRecorder.stop(sid);
      } catch {
        // ignore
      }
    }
  }

  const legacySessionId = session?.id || appSession?.sessionId;
  let stopped = session
    ? await updateSession(session.id, (s) => ({
        ...s,
        status: 'completed',
        stoppedAt: new Date().toISOString(),
        recorderStatus: 'stopped',
        finishAction: action,
        videoMimeType: stoppedRecording?.mimeType ?? s.videoMimeType,
        videoFormat: stoppedRecording?.videoFormat ?? s.videoFormat,
        videoSizeBytes: stoppedRecording?.size ?? s.videoSizeBytes,
        stitchWarning,
      }))
    : {
        id: legacySessionId,
        jobId,
        applyFlow: true,
        jdUrl: appSession?.originalJobUrl,
        bidderName: null,
        companyName: appSession?.companyName,
        jobTitle: appSession?.jobTitle,
        startedAt: appSession?.createdAt,
        stoppedAt: new Date().toISOString(),
        videoMimeType: stoppedRecording?.mimeType,
        videoFormat: stoppedRecording?.videoFormat,
        videoSizeBytes: stoppedRecording?.size,
      };

  let jobOutcome = null;
  let uploadResult = null;
  let uploadError = null;
  let statusError = null;

  if (closeApplyTab && tabId) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  // Close other session tabs on finish
  if (closeApplyTab && appSession && tabId != null) {
    for (const tid of appSession.activeTabIds || []) {
      if (Number(tid) !== Number(tabId)) {
        chrome.tabs.remove(tid).catch(() => {});
      }
    }
  }

  if (!jobId) {
    if (tabId) await clearPendingApply(tabId);
  }
  await updateRecordingBadge();
  if (tabId) broadcastApplySessionUpdate(tabId);
  if (tabId) await notifyTab(tabId, { isRecording: false });

  const hasVideo = (stoppedRecording?.size ?? 0) > 0;
  const applyFlow = session?.applyFlow || Boolean(appSession);

  if (applyFlow && jobId) {
    try {
      const auth = await MockApi.getAuth();
      const settings = await AthensApi.getSettings();
      const applierName = settings.applierName || auth?.applierName || auth?.displayName;
      if (applierName) {
        // Retry the latest captured filename at completion. The selection-time
        // request may have raced a navigation or a temporarily sleeping server.
        const storedSessions = await getSessions();
        const resumeAuditEvent = [stopped, ...storedSessions]
          .filter((candidate) => String(candidate?.jobId || '') === String(jobId))
          .flatMap((candidate) => candidate?.resumeEvents || [])
          .filter((event) => event?.originalName || event?.originalFileName)
          .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')))[0];
        if (resumeAuditEvent) {
          try {
            await AthensApi.saveResumeAudit(applierName, {
              jobId,
              originalName:
                resumeAuditEvent.originalName || resumeAuditEvent.originalFileName,
              expectedName:
                resumeAuditEvent.expectedName || stopped.expectedResumeName || undefined,
              cleanedName:
                resumeAuditEvent.cleanedName || resumeAuditEvent.submittedFileName || undefined,
              renamed: Boolean(resumeAuditEvent.renamed),
              company: stopped.companyName || appSession?.companyName,
              title: stopped.jobTitle || appSession?.jobTitle,
              pageUrl: resumeAuditEvent.pageUrl,
              sessionId: resumeAuditEvent.sessionId || stopped.id || undefined,
              source: resumeAuditEvent.source,
              fileSize: Number(resumeAuditEvent.fileSize),
              lastModified: Number(resumeAuditEvent.lastModified),
              mimeType: resumeAuditEvent.mimeType,
              auditKey: resumeAuditEvent.auditKey,
            });
          } catch (err) {
            console.warn('Bid Monitor: completion-time resume audit failed', err);
          }
        }

        if (hasVideo) {
          let blob = finalBlob;
          if (!blob) {
            const entry = await SessionVideoStore.get(legacySessionId);
            blob = entry?.blob;
          }
          if (blob && blob.size > 0) {
            const startedAt = stopped.startedAt ? new Date(stopped.startedAt).getTime() : null;
            const stoppedAt = stopped?.stoppedAt ? new Date(stopped.stoppedAt).getTime() : Date.now();
            const durationSec =
              startedAt && Number.isFinite(startedAt)
                ? Math.max(0, Math.round((stoppedAt - startedAt) / 1000))
                : null;
            // Wall-clock recording window (not just duration).
            const recordedStartAt =
              stopped.startedAt || appSession?.createdAt || null;
            const recordedEndAt =
              stopped?.stoppedAt || new Date(stoppedAt).toISOString();
            const ext = videoExtension(
              stoppedRecording?.mimeType ?? stopped.videoMimeType,
              stoppedRecording?.videoFormat ?? stopped.videoFormat,
            );
            uploadResult = await AthensApi.uploadRecording(applierName, {
              jobId,
              sessionId: appSession?.sessionId || legacySessionId,
              applyUrl: stopped.jdUrl || appSession?.originalJobUrl || undefined,
              bidderName: stopped.bidderName || auth?.displayName,
              contentType: stoppedRecording?.mimeType || blob.type || 'video/webm',
              fileName: `session.${ext}`,
              blob,
              durationSec,
              recordedStartAt,
              recordedEndAt,
              markCompleted: action === 'submit',
            });
            if (session?.id) {
              await updateSession(session.id, {
                recordingPath: uploadResult?.recording?.storagePath || null,
                uploadedAt: new Date().toISOString(),
              });
            }
          }
        }

        if (action === 'skip') {
          await AthensApi.skipBid(applierName, {
            jobId,
            bidderName: stopped.bidderName || auth?.displayName,
          });
          jobOutcome = 'skipped';
        } else if (!uploadResult?.recording || !hasVideo) {
          await AthensApi.completeBid(applierName, {
            jobId,
            bidderName: stopped.bidderName || auth?.displayName,
          });
          jobOutcome = 'submitted';
        } else {
          jobOutcome = 'submitted';
        }
      }
    } catch (err) {
      const name = err && typeof err === 'object' ? String(err.name || '') : '';
      const detail = err && typeof err === 'object' ? String(err.message || '') : '';
      const message =
        (name && detail ? `${name}: ${detail}` : detail || name) || String(err);
      if (message.toLowerCase().includes('upload') || hasVideo) uploadError = message;
      else statusError = message;
      console.error('Bid Monitor: Athens finish failed', message, err);
    }
  }

  if (jobId && (jobOutcome === 'submitted' || jobOutcome === 'skipped')) {
    const apply = await ApplyLifecycle.getByJobId(jobId);
    const finishedJob = apply?.job || {
      id: jobId,
      athensJobId: apply?.athensJobId || jobId,
      companyName: stopped.companyName || appSession?.companyName || 'Job',
      title: stopped.jobTitle || appSession?.jobTitle || '',
      jdUrl: stopped.jdUrl || appSession?.originalJobUrl || '',
    };
    await QueueSync.markJobFinished(
      jobId,
      jobOutcome === 'skipped' ? 'skipped' : 'applied',
      finishedJob,
    );
  }
  if (jobId) {
    await clearApplySessionByJobId(jobId);
  }
  if (appSession) {
    await ApplicationSessionStore.completeSession(appSession.sessionId);
  }

  chrome.runtime.sendMessage({ type: 'APPLICATION_SESSIONS_UPDATED' }).catch(() => {});

  return {
    ok: true,
    session: stopped,
    downloaded: false,
    finishAction: action,
    jobOutcome,
    jobMarkedApplied: jobOutcome === 'submitted',
    uploaded: Boolean(uploadResult?.success || uploadResult?.recording),
    withoutRecording: Boolean(applyFlow && !hasVideo),
    uploadError,
    statusError,
    recordingPath: uploadResult?.recording?.storagePath || null,
    stitchWarning,
  };
}

async function downloadPoolZip(poolId) {
  const auth = await MockApi.getAuth();
  if (!auth) throw new Error('Sign in required.');

  const pools = await MockApi.getPoolsForProfile(auth.profileName);
  const pool = MockApi.findPool(pools, poolId);
  if (!pool) throw new Error('Job pool not found.');

  const entries = MockApi.getPoolDownloadEntries(pool);
  const manifest = {
    poolId: pool.id,
    poolName: pool.name,
    poolStatus: pool.status,
    profileName: auth.profileName,
    exportedAt: new Date().toISOString(),
    entries,
  };

  const zipEntries = [
    {
      name: 'pool-manifest.json',
      data: ZipUtils.stringToBytes(JSON.stringify(manifest, null, 2)),
    },
  ];

  for (const folderName of MockApi.getUniqueResumeFolders(pool)) {
    zipEntries.push({
      name: `${folderName}/${folderName}.pdf`,
      data: ZipUtils.createMockPdfBytes(folderName),
    });
  }

  const zipBytes = ZipUtils.createZip(zipEntries);
  const dataUrl = ZipUtils.bytesToDataUrl(zipBytes, 'application/zip');
  const safePoolName = sanitizeFileName(pool.name);

  await chrome.downloads.download({
    url: dataUrl,
    filename: `bid-monitor/pools/${safePoolName}-${pool.id}.zip`,
  });
}

async function restoreActiveRecordingIfNeeded() {
  // Rehydrate the in-memory tab→session map first. Any session id returned here
  // is still actively recording in the offscreen document (survived the SW
  // restart), so it must NOT be marked failed/interrupted below.
  let liveSessionIds = new Set();
  try {
    liveSessionIds = await SessionRecorder.rehydrateFromStorage();
  } catch (err) {
    console.warn('Bid Monitor: recorder rehydrate failed', err);
  }
  await cleanupOrphanRecordingSessions();
  const sessions = await getRecordingSessions();
  if (sessions.length) {
    await updateRecordingBadge();
    await SessionRecorder.restore(sessions);
    await notifyAllRecordingTabs();
  }
  await SegmentLifecycle.restoreFromStorage(liveSessionIds);
}

restoreActiveRecordingIfNeeded().catch(console.error);

// Chrome only grants tabCapture after the extension is invoked for the page
// (toolbar icon or context menu). A side-panel button click is not enough.
// Capture streamId synchronously in this gesture, then start recording.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  if (!tab?.id) return;

  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
    const err = chrome.runtime.lastError;
    void handleRecordingGesture(tab, err ? null : streamId);
  });
});

async function handleRecordingGesture(tab, streamId) {
  // Already recording on this tab — open finish controls for apply flow.
  if (SessionRecorder.getSessionIdForTab(tab.id)) {
    const existing = await getSessionForTab(tab.id);
    if (existing?.applyFlow || (await ApplicationSessionStore.getSessionByTabId(tab.id))) {
      if (tab?.windowId != null) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      }
      chrome.runtime
        .sendMessage({ type: 'PANEL_HIGHLIGHT_FINISH', tabId: tab.id })
        .catch(() => {});
      return;
    }
  }

  // Resume a failed segment on this tab if present.
  if (streamId) {
    const resumed = await SegmentLifecycle.resumeFailedSegmentOnTab(tab, streamId);
    if (resumed?.ok) {
      broadcastApplySessionUpdate(tab.id);
      chrome.runtime
        .sendMessage({ type: 'PANEL_HIGHLIGHT_START', tabId: tab.id })
        .catch(() => {});
      return;
    }
    if (resumed?.reason === 'already_recording') return;
    if (resumed?.reason !== 'no_segment') {
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'SEGMENT_CAPTURE_REQUIRED',
          message:
            resumed?.error ||
            'Could not record this tab. Click the Bid Monitor toolbar icon again.',
        })
        .catch(() => {});
      return;
    }
  }

  const existing = await getSessionForTab(tab.id);
  if (existing) {
    if (existing.applyFlow) {
      if (tab?.windowId != null) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      }
      chrome.runtime
        .sendMessage({ type: 'PANEL_HIGHLIGHT_FINISH', tabId: tab.id })
        .catch(() => {});
      return;
    }
    await completeRecordingSession({
      tabId: tab.id,
      closeApplyTab: false,
      finishAction: 'submit',
    });
    return;
  }

  if (!streamId) {
    chrome.runtime
      .sendMessage({ type: 'PANEL_HIGHLIGHT_START', tabId: tab?.id ?? null })
      .catch(() => {});
    return;
  }

  await startRecordingFromGesture(tab, streamId);
}

async function startRecordingFromGesture(tab, streamId) {
  const auth = await MockApi.getAuth();
  if (!auth || auth.role !== 'bidder') return;

  const pendingAll = await getPendingApplyTabs();
  const pending = pendingAll[tab.id];

  try {
    if (pending?.job) {
      const { videoFormat = 'webm' } = await chrome.storage.local.get('videoFormat');
      let appSession =
        (await ApplicationSessionStore.getSessionByTabId(tab.id)) ||
        (await ApplicationSessionStore.getSessionByJobId(pending.job.id));
      if (!appSession) {
        const opened = await SegmentLifecycle.onApplyOpened({
          jobId: pending.job.id,
          jobTitle: pending.job.title,
          companyName: pending.job.companyName,
          originalJobUrl: pending.job.jdUrl,
          tabId: tab.id,
          poolId: pending.poolId,
          athensJobId: pending.job.athensJobId || pending.job.id,
        });
        appSession = opened.session;
      }

      let segment = await ApplicationSessionStore.getSegmentByTabId(tab.id);
      if (!segment) {
        segment = await ApplicationSessionStore.createSegment({
          sessionId: appSession.sessionId,
          tabId: tab.id,
          openerTabId: tab.openerTabId ?? null,
          url: tab.url || pending.job.jdUrl,
          status: 'recording',
        });
      }

      const result = await SegmentLifecycle.startSegmentCapture(segment, tab, {
        streamId,
        videoFormat,
      });
      if (!result.ok) throw new Error(result.error || 'Could not start recording.');
      await ApplyLifecycle.upsert(pending.job.id, {
        applicationSessionId: appSession.sessionId,
        recorderStatus: result.recording?.startedPaused ? 'paused' : 'recording',
        error: null,
      });

      // Mirror legacy bidMonitorSessions so GET_ACTIVE_APPLY / finish UI stay in sync.
      if (!(await getSessionForTab(tab.id))) {
        await beginRecordingSession({
          tab,
          bidderName: auth.displayName,
          resumeSetFolder: pending.job.resumeFolderName,
          videoFormat,
          jobId: pending.job.id,
          poolId: pending.poolId,
          companyName: pending.job.companyName,
          jobTitle: pending.job.title,
          jdUrl: pending.job.jdUrl,
          applyFlow: true,
          streamId,
          applicationSessionId: appSession.sessionId,
          segmentId: segment.segmentId,
          skipRecorderStart: true,
          recordingMeta: result.recording,
        });
      }
    } else {
      // Manual start on any http(s) tab — unassigned until Stop/close merge prompt.
      const manual = await SegmentLifecycle.startManualSegment(tab.id, streamId);
      if (manual?.segment?.sessionId) {
        const linked = await ApplicationSessionStore.getSession(manual.segment.sessionId);
        if (linked?.jobId) {
          await ApplyLifecycle.upsert(linked.jobId, {
            applicationSessionId: linked.sessionId,
            recorderStatus: 'recording',
            error: null,
          });
        }
      }
    }

    broadcastApplySessionUpdate(tab.id);
    chrome.runtime
      .sendMessage({ type: 'PANEL_HIGHLIGHT_START', tabId: tab.id })
      .catch(() => {});
  } catch (err) {
    const p = (await getPendingApplyTabs())[tab.id];
    if (p?.job) {
      await notifyRecordingFailed(tab.id, {
        profileName: p.profileName ?? '',
        job: p.job,
        error: err.message,
      });
    }
    broadcastApplySessionUpdate(tab.id);
    chrome.runtime
      .sendMessage({
        type: 'PANEL_HIGHLIGHT_START',
        tabId: tab.id,
        error: err?.message || 'Could not start recording.',
      })
      .catch(() => {});
  }
}

const RECORD_MENU_ID = 'bid-monitor-toggle-recording';

function createContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: RECORD_MENU_ID,
      title: 'Bid Monitor: Start / Stop recording this tab',
      contexts: ['page', 'action'],
    }, () => { void chrome.runtime.lastError; });
  });
}

createContextMenus();
chrome.runtime.onInstalled.addListener(createContextMenus);

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== RECORD_MENU_ID || !tab?.id) return;
    // Synchronous capture in the gesture; start/stop decided in the callback.
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
      const err = chrome.runtime.lastError;
      void handleRecordingGesture(tab, err ? null : streamId);
    });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupStoredSessionForClosedTab(tabId).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;

  (async () => {
    const apply = await ApplyLifecycle.getByTabId(tabId);
    if (!apply?.job || apply.recorderStatus !== 'ready') return;

    await notifyApplyPanel(tabId, {
      profileName: apply.bidderName || apply.profileName || '',
      recorderStatus: 'ready',
      session: {
        resumeSetFolder: apply.job.resumeFolderName,
        applyFlow: true,
        pending: true,
      },
      job: apply.job,
    });
  })().catch(console.error);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  syncStoredRecorderStatuses(activeInfo.windowId, activeInfo.tabId).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_PING') {
    return false;
  }

  if (message.type === 'VIDEO_DOWNLOAD_DONE') {
    return false;
  }

  if (message.type?.startsWith('OFFSCREEN_')) {
    return false;
  }

  (async () => {
    switch (message.type) {
      case 'SIGN_IN': {
        if (message.apiUrl || message.applierName) {
          await AthensApi.saveSettings({
            applierName: message.applierName || message.username,
            apiUrl: message.apiUrl,
          });
        }
        const result = await MockApi.signIn(message.username, message.password, {
          applierName: message.applierName || message.username,
          apiUrl: message.apiUrl,
          displayName: message.displayName || message.applierName || message.username,
        });
        // Queue loads in the background after UI unlocks.
        if (result?.ok) {
          QueueSync.fetchDashboardState({ useCache: true, enrichResumes: true })
            .then(() => {
              chrome.runtime.sendMessage({ type: 'QUEUE_ENRICHED' }).catch(() => {});
            })
            .catch(() => {});
        }
        sendResponse(result);
        break;
      }

      case 'SIGN_OUT': {
        const applies = await ApplyLifecycle.getAll();
        for (const jobId of Object.keys(applies)) {
          await ApplyLifecycle.remove(jobId);
        }
        const appSessions = await ApplicationSessionStore.listSessions();
        for (const s of appSessions) {
          await ApplicationSessionStore.removeSessionAndSegments(s.sessionId).catch(() => {});
        }
        sendResponse(await MockApi.signOut());
        break;
      }

      case 'GET_DASHBOARD': {
        const preferCache = Boolean(message.preferCache);
        sendResponse(
          preferCache
            ? await MockApi.getDashboardState({ preferCache: true })
            : await MockApi.getDashboardState({ preferCache: false }),
        );
        break;
      }

      case 'GET_UI_STATE': {
        const auth = await MockApi.getAuth();
        const dashboard = auth
          ? await MockApi.getDashboardState({ preferCache: true })
          : { auth: null, pools: [], athensError: null };
        const activeApply = await ApplyLifecycle.resolveActiveApply();
        let session = null;
        if (activeApply?.applyTabId != null) {
          session = await getSessionForTab(activeApply.applyTabId);
        }
        if (!session && activeApply?.jobId) {
          const sessions = await getSessions();
          session =
            sessions.find(
              (s) =>
                s.applyFlow &&
                s.status === 'recording' &&
                String(s.jobId) === String(activeApply.jobId),
            ) || null;
        }
        const health = await AthensApi.checkAthensHealth().catch(() => ({
          healthy: false,
        }));
        let focusedTabId = null;
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          focusedTabId = activeTab?.id ?? null;
        } catch {
          focusedTabId = null;
        }
        const applicationUi = await ApplicationSessionStore.getUiSnapshot(focusedTabId);
        sendResponse({
          ok: true,
          auth: dashboard.auth || auth,
          pools: dashboard.pools || [],
          athensError: dashboard.athensError || null,
          fromCache: Boolean(dashboard.fromCache),
          refreshing: Boolean(dashboard.refreshing),
          activeApply,
          session,
          isRecording: Boolean(session) ||
            (activeApply?.applyTabId != null &&
              Boolean(SessionRecorder.getSessionIdForTab(activeApply.applyTabId))) ||
            Boolean(
              activeApply?.jobId &&
                (await ApplicationSessionStore.getSessionByJobId(activeApply.jobId))?.activeTabIds?.some(
                  (tid) => Boolean(SessionRecorder.getSessionIdForTab(Number(tid))),
                ),
            ),
          athensHealthy: Boolean(health.healthy),
          recordingSessions: await getRecordingSessions(),
          applicationSessions: applicationUi.sessions,
          unassignedSegments: applicationUi.unassignedSegments,
          emptyClips: applicationUi.emptyClips,
          pendingMergeSegment: applicationUi.pendingMergeSegment,
          pendingFinishSession: applicationUi.pendingFinishSession,
          needsMergeBadge: applicationUi.needsMergeBadge,
          waitingClipCount: applicationUi.waitingClipCount,
        });
        break;
      }

      case 'GET_APPLICATION_SESSIONS': {
        let focusedTabId = null;
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          focusedTabId = activeTab?.id ?? null;
        } catch {
          focusedTabId = null;
        }
        const snapshot = await ApplicationSessionStore.getUiSnapshot(focusedTabId);
        sendResponse({ ok: true, ...snapshot });
        break;
      }

      case 'GET_TAB_RECORDING_STATE': {
        sendResponse({
          ok: true,
          ...(await SegmentLifecycle.getTabRecordingState(message.tabId)),
        });
        break;
      }

      case 'START_TAB_RECORDING_WITH_STREAM': {
        try {
          const result = await SegmentLifecycle.startManualSegment(
            message.tabId,
            message.streamId,
          );
          sendResponse({ ok: true, ...result });
        } catch (err) {
          sendResponse({
            ok: false,
            error: formatTabCaptureError(err.message || String(err)),
          });
        }
        break;
      }

      case 'STOP_TAB_RECORDING': {
        try {
          const result = await SegmentLifecycle.stopManualSegment(message.tabId);
          if (result?.ok) {
            const legacySession = await getSessionForTab(message.tabId);
            if (legacySession) {
              const sessions = await getSessions();
              await saveSessions(
                sessions.filter((session) => session.id !== legacySession.id),
              );
            }
            await updateRecordingBadge();
          }
          sendResponse(result);
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Could not stop recording.' });
        }
        break;
      }

      case 'MERGE_SEGMENT': {
        try {
          const result = await SegmentLifecycle.mergePendingSegment(
            message.segmentId,
            message.sessionId,
          );
          await updateNeedsMergeBadge();
          sendResponse({ ok: true, ...result });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Merge failed.' });
        }
        break;
      }

      case 'DISCARD_SEGMENT': {
        try {
          await SegmentLifecycle.discardPendingSegment(message.segmentId);
          await updateNeedsMergeBadge();
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Discard failed.' });
        }
        break;
      }

      case 'KEEP_SEGMENT_UNASSIGNED': {
        try {
          await SegmentLifecycle.keepUnassignedForLater(message.segmentId);
          await updateNeedsMergeBadge();
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Keep failed.' });
        }
        break;
      }

      case 'DISMISS_FINISH_PROMPT': {
        await ApplicationSessionStore.clearPendingFinishPrompt();
        sendResponse({ ok: true });
        break;
      }

      case 'FINISH_APPLICATION_SESSION': {
        try {
          const sessionId = message.sessionId;
          const appSession = await ApplicationSessionStore.getSession(sessionId);
          if (!appSession) {
            sendResponse({ ok: false, error: 'Application not found.' });
            break;
          }
          const tabId =
            (appSession.activeTabIds || [])[0] ||
            (await ApplyLifecycle.getByJobId(appSession.jobId))?.applyTabId ||
            null;
          await ApplicationSessionStore.clearPendingFinishPrompt();
          const result = await completeRecordingSession({
            tabId,
            jobId: appSession.jobId,
            closeApplyTab: Boolean(message.closeTabs),
            finishAction: message.finishAction === 'skip' ? 'skip' : 'submit',
          });
          sendResponse(result);
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Finish failed.' });
        }
        break;
      }

      case 'REOPEN_APPLY_TAB': {
        try {
          const jobId = String(message.jobId || '').trim();
          const apply = jobId
            ? await ApplyLifecycle.getByJobId(jobId)
            : await ApplyLifecycle.resolveActiveApply();
          if (!apply?.job?.jdUrl) {
            sendResponse({ ok: false, error: 'No active apply session to reopen.' });
            break;
          }
          if (apply.applyTabId != null) {
            try {
              const existing = await chrome.tabs.get(apply.applyTabId);
              await chrome.tabs.update(existing.id, { active: true });
              sendResponse({ ok: true, tabId: existing.id, reused: true });
              break;
            } catch {
              /* recreate */
            }
          }
          const tab = await chrome.tabs.create({ url: apply.job.jdUrl, active: true });
          await ApplyLifecycle.upsert(apply.jobId, {
            applyTabId: tab.id,
            recorderStatus: apply.recorderStatus === 'recording' ? 'ready' : apply.recorderStatus || 'ready',
          });
          await notifyApplyPanel(tab.id, {
            profileName: apply.bidderName || apply.profileName || '',
            recorderStatus: 'ready',
            session: {
              resumeSetFolder: apply.job.resumeFolderName,
              applyFlow: true,
              pending: true,
            },
            job: apply.job,
          });
          broadcastApplySessionUpdate(tab.id);
          sendResponse({ ok: true, tabId: tab.id, reused: false });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Failed to reopen job tab.' });
        }
        break;
      }

      case 'GET_MOCK_HINT': {
        sendResponse({ ok: true, hint: MockApi.getMockCredentialsHint() });
        break;
      }

      case 'DOWNLOAD_POOL': {
        await downloadPoolZip(message.poolId);
        sendResponse({ ok: true });
        break;
      }

      case 'CHECK_JOB_RESUME': {
        try {
          const settings = await AthensApi.getSettings();
          const auth = await MockApi.getAuth();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          const jobId = String(message.jobId || '').trim();
          if (!applierName || !jobId) {
            sendResponse({ ok: true, hasResume: false });
            break;
          }
          const withResume = await AthensApi.checkGeneratedResumes(applierName, [jobId]);
          sendResponse({ ok: true, hasResume: withResume.has(jobId) });
        } catch (err) {
          sendResponse({ ok: false, hasResume: false, error: err.message });
        }
        break;
      }

      case 'OPEN_JOB_RESUME': {
        try {
          const settings = await AthensApi.getSettings();
          const auth = await MockApi.getAuth();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          const jobId = String(message.jobId || '').trim();
          if (!applierName || !jobId) {
            sendResponse({ ok: false, error: 'Missing applier or job for résumé.' });
            break;
          }
          const url = await AthensApi.getResumePdfUrl(applierName, jobId);
          await chrome.tabs.create({ url, active: true });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Failed to open résumé.' });
        }
        break;
      }

      case 'DOWNLOAD_JOB_RESUME': {
        try {
          const settings = await AthensApi.getSettings();
          const auth = await MockApi.getAuth();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          const jobId = String(message.jobId || '').trim();
          if (!applierName || !jobId) {
            sendResponse({ ok: false, error: 'Missing applier or job for résumé.' });
            break;
          }
          const preferredName = String(message.fileName || '').trim();
          const url = await AthensApi.getResumePdfUrl(applierName, jobId);
          const safeStem = sanitizeResumeDownloadName(preferredName || applierName);
          await chrome.downloads.download({
            url,
            filename: `bid-monitor/${safeStem}.pdf`,
            saveAs: false,
          });
          sendResponse({ ok: true, fileName: `${safeStem}.pdf` });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Failed to download résumé.' });
        }
        break;
      }

      case 'APPLY_PREPARE_TAB': {
        try {
          await cleanupOrphanRecordingSessions();
          const { auth, pool, job } = await resolveApplyJob(message);
          const tab = await chrome.tabs.get(message.tabId);

          let streamId = message.streamId ?? null;
          if (!streamId) {
            try {
              streamId = await captureTabStreamId(tab.id);
            } catch {
              // Capture may fail before the page loads; retry after the page is ready.
            }
          }

          let tabState = await waitForCapturableTab(tab.id);
          tabState = await prepareTabForCapture(tabState);
          await ensureTabScriptsReady(tabState.id);

          if (!streamId) {
            try {
              streamId = await captureTabStreamId(tabState.id);
            } catch {
              // Will retry during APPLY_TO_JOB / panel retry.
            }
          }

          const jobPayload = {
            id: job.id,
            companyName: job.companyName,
            title: job.title,
            jdUrl: job.jdUrl,
            resumeFolderName: job.resumeFolderName,
          };

          await setPendingApply(tabState.id, {
            profileName: auth.displayName,
            recorderStatus: 'starting',
            poolId: pool.id,
            streamId,
            job: jobPayload,
          });

          await notifyTabWithRetry(tabState.id, {
            type: 'APPLY_STARTED',
            profileName: auth.displayName,
            recorderStatus: 'starting',
            session: {
              resumeSetFolder: job.resumeFolderName,
              applyFlow: true,
            },
            job: jobPayload,
          });

          sendResponse({
            ok: true,
            tabId: tabState.id,
            profileName: auth.displayName,
            poolId: pool.id,
            streamId,
            job: jobPayload,
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case 'RESET_ACTIVE_JOBS': {
        const auth = await MockApi.getAuth();
        if (!auth) {
          sendResponse({ ok: false, error: 'Sign in required.' });
          break;
        }
        sendResponse(await MockApi.resetActiveJobs(auth.profileName));
        break;
      }

      case 'APPLY_OPEN_JOB': {
        try {
          const tabId = message.tabId;
          if (!tabId) {
            sendResponse({ ok: false, error: 'No tab specified.' });
            break;
          }
          const result = await openApplyOnTab(
            tabId,
            message.poolId,
            message.jobId,
            message.streamId ?? null,
          );
          sendResponse(result);
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case 'APPLY_TO_JOB': {
        // Full Apply path: create tab + capture stream in one gesture, auto-start recording.
        if (message.jobUrl) {
          handleApplyToJob(message, sendResponse);
          return true;
        }
        try {
          if (!message.tabId) {
            sendResponse({ ok: false, error: 'Use Apply from the Bid Monitor side panel.' });
            break;
          }
          const result = await openApplyOnTab(
            message.tabId,
            message.poolId,
            message.jobId,
            message.streamId ?? null,
          );
          sendResponse(result);
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case 'REQUEST_PANEL_START_RECORDING': {
        const tabId = sender.tab?.id ?? null;
        try {
          if (tabId) {
            const tab = await chrome.tabs.get(tabId);
            await chrome.sidePanel.setOptions({
              tabId,
              path: 'sidepanel/panel.html',
              enabled: true,
            });
            await chrome.sidePanel.open({ windowId: tab.windowId });
          }
        } catch (err) {
          console.warn('Bid Monitor: could not open side panel for recording', err);
        }

        chrome.runtime.sendMessage({
          type: 'PANEL_HIGHLIGHT_START',
          tabId,
        }).catch(() => {});

        sendResponse({
          ok: false,
          error: 'Click Start Recording in the side panel. If Chrome asks what to share, pick the job tab.',
        });
        break;
      }

      case 'GET_PENDING_STREAM_ID': {
        const tabId = Number(message.tabId);
        const apply = await ApplyLifecycle.getByTabId(tabId);
        sendResponse({
          ok: true,
          streamId: apply?.streamId ?? null,
        });
        break;
      }

      case 'CONSUME_PENDING_STREAM_ID': {
        const tabId = Number(message.tabId);
        const apply = await ApplyLifecycle.getByTabId(tabId);
        if (apply) {
          await ApplyLifecycle.upsert(apply.jobId, {
            streamId: null,
            streamIdCapturedAt: null,
          });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'SIDE_PANEL_RECORDING_STARTED': {
        try {
          const tabId = message.tabId;
          if (!tabId) {
            sendResponse({ ok: false, error: 'No job tab specified.' });
            break;
          }
          const started = await registerSidePanelRecording(tabId, {
            mimeType: message.mimeType,
            videoFormat: message.videoFormat,
            fallbackUsed: message.fallbackUsed,
            skipCapturableCheck: Boolean(message.autoStart),
          });
          sendResponse({
            ok: true,
            session: started.session,
            fallbackUsed: started.fallbackUsed,
          });
        } catch (err) {
          sendResponse({ ok: false, error: formatTabCaptureError(err.message) });
        }
        break;
      }

      case 'SIDE_PANEL_RECORDING_STOPPED': {
        try {
          const tabId = message.tabId;
          const session = await getSessionForTab(tabId);
          if (session && message.videoBuffer?.byteLength > 0) {
            const blob = new Blob([message.videoBuffer], { type: message.mimeType || 'video/webm' });
            await SessionVideoStore.save(session.id, blob, {
              mimeType: message.mimeType,
              videoFormat: message.videoFormat,
            });
          }
          const result = await completeRecordingSession({
            tabId,
            closeApplyTab: Boolean(message.closeApplyTab),
            finishAction: message.finishAction === 'skip' ? 'skip' : 'submit',
            recordingResult: {
              mimeType: message.mimeType,
              videoFormat: message.videoFormat,
              size: message.size ?? 0,
            },
          });
          sendResponse(result);
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case 'SAVE_SESSION_VIDEO': {
        try {
          const { sessionId, videoBuffer, mimeType, videoFormat } = message;
          if (!sessionId || !videoBuffer) {
            sendResponse({ ok: false, error: 'Missing session video payload.' });
            break;
          }
          const blob = new Blob([videoBuffer], { type: mimeType || 'video/webm' });
          await SessionVideoStore.save(sessionId, blob, { mimeType, videoFormat });
          sendResponse({ ok: true, size: blob.size, mimeType, videoFormat });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case 'RETRY_CAPTURE': {
        sendResponse({
          ok: false,
          error: 'Open the Bid Monitor side panel and click Start Recording.',
        });
        break;
      }

      case 'START_CAPTURE': {
        const tab = message.tabId
          ? await chrome.tabs.get(message.tabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

        const started = await beginRecordingSession({
          tab,
          bidderName: message.bidderName,
          resumeSetFolder: message.resumeSetFolder,
          videoFormat: message.videoFormat,
        });

        sendResponse({
          ok: true,
          session: started.session,
          fallbackUsed: started.recording?.fallbackUsed ?? false,
        });
        break;
      }

      case 'STOP_CAPTURE': {
        const tabId = sender.tab?.id ?? message.tabId;
        const result = await completeRecordingSession({
          tabId,
          jobId: message.jobId || null,
          closeApplyTab: message.closeApplyTab !== false,
          finishAction: message.finishAction === 'skip' ? 'skip' : 'submit',
        });
        sendResponse(result);
        break;
      }

      case 'CHECK_BRIDGE':
      case 'CHECK_ATHENS': {
        try {
          const health = await AthensApi.checkAthensHealth();
          sendResponse({
            ok: true,
            healthy: Boolean(health.healthy),
            // Never expose host/IP/URL to the extension UI.
            error: health.healthy ? null : 'Cannot reach Athens right now.',
          });
        } catch {
          sendResponse({ ok: false, healthy: false, error: 'Cannot reach Athens right now.' });
        }
        break;
      }

      case 'ANALYZE_JOB_TAB': {
        try {
          const tabId = message.tabId ?? sender.tab?.id;
          if (!tabId) {
            sendResponse({ ok: false, error: 'No tab to analyze.' });
            break;
          }
          const pageContext = await PageContext.extractFromTab(tabId);
          if (!pageContext?.visibleText) {
            sendResponse({
              ok: false,
              error: 'Could not read page text from this tab (try the job application page).',
            });
            break;
          }

          const auth = await MockApi.getAuth();
          const settings = await AthensApi.getSettings();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          const sessionContext = {
            companyName: message.companyName || '',
            jobTitle: message.jobTitle || '',
            applyUrl: message.applyUrl || pageContext.url,
          };

          const jobId = message.jobId || null;

          const [pageRes, flagsRes] = await Promise.all([
            AthensApi.analyzeJobPage(applierName, {
              pageContext,
              sessionContext,
              jobId,
            }).catch((err) => ({ error: err.message })),
            AthensApi.analyzeJobFlags(applierName, {
              pageContext,
              sessionContext,
              neededFlags: ['remote', 'clearance'],
              jobId,
            }).catch((err) => ({ error: err.message })),
          ]);

          if (pageRes?.error && flagsRes?.error) {
            sendResponse({
              ok: false,
              error:
                pageRes.error ||
                flagsRes.error ||
                'Analyze failed. Is Athens-server running?',
            });
            break;
          }

          const page = pageRes?.result || null;
          const flagPartial = flagsRes?.result || {};
          const flags = {
            remote: flagPartial.remote ?? null,
            clearance: flagPartial.clearance ?? null,
          };
          const summary = page?.summary || null;
          const jdAnalyzed = Boolean(page?.isJobPage || summary || flags.remote || flags.clearance);
          const mode = pageRes?.mode || flagsRes?.mode || null;

          if (applierName && jobId && (flags.remote || flags.clearance || summary)) {
            try {
              await AthensApi.saveBidFlags(applierName, { jobId, flags, summary });
            } catch (err) {
              console.warn('Bid Monitor: save flags failed', err);
            }
          }

          const formAnswers = Array.isArray(page?.formAnswers) ? page.formAnswers : [];
          // Count answers from page text (AI), not DOM label/name field count.
          const formCount = page?.formCount ?? formAnswers.length;
          let priorRecommend = null;
          if (jobId) {
            const existing = await ApplyLifecycle.getByJobId(jobId);
            priorRecommend = existing?.analysis?.recommend || null;
            if (!priorRecommend) {
              const active = await ApplyLifecycle.resolveActiveApply();
              if (
                active &&
                (String(active.jobId) === String(jobId) ||
                  String(active.athensJobId) === String(jobId))
              ) {
                priorRecommend = active.analysis?.recommend || null;
              }
            }
          }
          const analysis = {
            jdAnalyzed,
            flags,
            summary,
            formAnswers,
            formCount,
            charCount: pageContext.sourceMeta?.charCount ?? pageContext.visibleText.length,
            mode,
            error:
              mode === 'heuristic'
                ? 'Analyzed with local heuristics (no LLM key or LLM unavailable)'
                : pageRes?.error || flagsRes?.error || null,
            pageUrl: pageContext.url,
            pageTitle: pageContext.title,
            ...(priorRecommend ? { recommend: priorRecommend } : {}),
          };

          if (jobId) {
            const existing = await ApplyLifecycle.getByJobId(jobId);
            if (existing) {
              await ApplyLifecycle.setAnalysis(jobId, analysis);
            } else {
              // Persist analysis even if Apply was started under athensJobId.
              const active = await ApplyLifecycle.resolveActiveApply();
              if (active && (String(active.jobId) === String(jobId) || String(active.athensJobId) === String(jobId))) {
                await ApplyLifecycle.setAnalysis(active.jobId, analysis);
              }
            }
          }

          sendResponse({
            ok: true,
            jdAnalyzed,
            summary,
            page,
            formAnswers,
            formCount,
            flags,
            mode,
            pageUrl: pageContext.url,
            pageTitle: pageContext.title,
            charCount: analysis.charCount,
            pageError: pageRes?.error || null,
            flagsError: flagsRes?.error || null,
            analysis,
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Analyze failed.' });
        }
        break;
      }

      case 'RECOMMEND_RESUME': {
        try {
          const tabId = message.tabId ?? sender.tab?.id;
          if (!tabId) {
            sendResponse({ ok: false, error: 'No tab to analyze.' });
            break;
          }
          const pageContext = await PageContext.extractFromTab(tabId);
          if (!pageContext?.visibleText) {
            sendResponse({
              ok: false,
              error: 'Could not read page text from this tab (try the job description page).',
            });
            break;
          }

          const auth = await MockApi.getAuth();
          const settings = await AthensApi.getSettings();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          if (!applierName) {
            sendResponse({ ok: false, error: 'Athens applier name is required.' });
            break;
          }

          const jobId = message.jobId || null;
          const recommendRes = await AthensApi.recommendResume(applierName, {
            pageContext,
            jobId,
          });

          if (recommendRes?.error || recommendRes?.success === false || recommendRes?.ok === false) {
            sendResponse({
              ok: false,
              error:
                recommendRes?.error ||
                'Recommend resume failed. Is Athens-server running?',
            });
            break;
          }

          const result = recommendRes?.result || recommendRes || {};
          const recommend = {
            recommendedResume: result.matchedCatalogKey || result.recommendedResume || null,
            useCustomizedResume: Boolean(result.useCustomizedResume),
            warning: result.warning || null,
            reason: result.reason || null,
            isJobDescription: Boolean(result.isJobDescription),
            updatedAt: new Date().toISOString(),
          };

          if (jobId) {
            const existing = await ApplyLifecycle.getByJobId(jobId);
            const prevAnalysis = existing?.analysis || {};
            const nextAnalysis = { ...prevAnalysis, recommend };
            if (existing) {
              await ApplyLifecycle.setAnalysis(jobId, nextAnalysis);
            } else {
              const active = await ApplyLifecycle.resolveActiveApply();
              if (
                active &&
                (String(active.jobId) === String(jobId) ||
                  String(active.athensJobId) === String(jobId))
              ) {
                await ApplyLifecycle.setAnalysis(active.jobId, {
                  ...(active.analysis || {}),
                  recommend,
                });
              }
            }
          }

          sendResponse({
            ok: true,
            recommend,
            result,
            usage: recommendRes?.usage || null,
            mode: recommendRes?.mode || null,
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || 'Recommend resume failed.' });
        }
        break;
      }

      case 'GET_STATE': {
        const sessions = await getSessions();
        const dashboard = await MockApi.getDashboardState();
        const recordingSessions = await getRecordingSessions();
        sendResponse({
          ok: true,
          sessions: sessions.slice(0, 20),
          recordingSessions,
          auth: dashboard.auth,
          pools: dashboard.pools,
        });
        break;
      }

      case 'GET_ACTIVE_APPLY': {
        let apply = null;
        if (message.tabId) {
          apply = await ApplyLifecycle.getByTabId(message.tabId);
        }
        if (!apply) {
          apply = await ApplyLifecycle.resolveActiveApply();
        }

        let tabId = apply?.applyTabId ?? message.tabId ?? null;
        let session = tabId ? await getSessionForTab(tabId) : null;

        if (!session && apply?.jobId) {
          const sessions = await getSessions();
          session =
            sessions.find(
              (s) =>
                s.applyFlow &&
                s.status === 'recording' &&
                String(s.jobId) === String(apply.jobId),
            ) || null;
          if (session?.tabId != null) {
            try {
              await chrome.tabs.get(session.tabId);
              tabId = session.tabId;
            } catch {
              /* keep apply without live tab */
            }
          }
        }

        if (!apply && !session) {
          // Fallback: recording-only without lifecycle record.
          const sessions = await getSessions();
          session =
            sessions.find((s) => s.applyFlow && s.status === 'recording' && s.tabId != null) ||
            null;
          if (session) {
            try {
              await chrome.tabs.get(session.tabId);
              tabId = session.tabId;
            } catch {
              session = null;
            }
          }
        }

        let applyJob = apply?.job ?? null;
        let recorderStatus = apply?.recorderStatus ?? null;
        let error = apply?.error ?? null;

        if (session?.applyFlow) {
          applyJob = {
            id: session.jobId,
            athensJobId: apply?.athensJobId || session.jobId,
            companyName: session.companyName,
            title: session.jobTitle,
            jdUrl: session.jdUrl,
            resumeFolderName: session.resumeSetFolder,
            expectedResumeName:
              session.expectedResumeName ||
              apply?.job?.expectedResumeName ||
              null,
            hasGeneratedResume: Boolean(apply?.job?.hasGeneratedResume),
          };
          recorderStatus = session.recorderStatus ?? 'recording';
        }

        const pending = apply
          ? {
              profileName: apply.bidderName || apply.profileName,
              recorderStatus: apply.recorderStatus,
              poolId: apply.poolId,
              job: apply.job,
              error: apply.error,
              updatedAt: apply.updatedAt,
            }
          : null;

        // Live capture may exist without a legacy bidMonitorSessions row
        // (toolbar / side-panel Start paths). Prefer SessionRecorder truth.
        let isLiveRecording = Boolean(session);
        if (!isLiveRecording && tabId != null) {
          isLiveRecording = Boolean(SessionRecorder.getSessionIdForTab(tabId));
        }
        if (!isLiveRecording && apply?.jobId) {
          const appSession = await ApplicationSessionStore.getSessionByJobId(apply.jobId);
          if (appSession) {
            isLiveRecording = (appSession.activeTabIds || []).some((tid) =>
              Boolean(SessionRecorder.getSessionIdForTab(Number(tid))),
            );
          }
        }
        if (
          !isLiveRecording &&
          (apply?.recorderStatus === 'recording' || apply?.recorderStatus === 'paused')
        ) {
          isLiveRecording = true;
        }

        if (isLiveRecording && !recorderStatus) {
          recorderStatus = 'recording';
        }

        sendResponse({
          ok: true,
          tabId,
          jobId: apply?.jobId || applyJob?.id || null,
          pending,
          session,
          isRecording: isLiveRecording,
          applyJob,
          recorderStatus,
          error,
          analysis: apply?.analysis || null,
          tabMissing: Boolean(apply?.job && apply.applyTabId == null && !session && !isLiveRecording),
        });
        break;
      }

      case 'GET_TAB_CONTEXT': {
        const auth = await MockApi.getAuth();
        const tabId = sender.tab?.id;
        let session = await getSessionForTab(tabId);
        let applyJob = null;
        let recorderStatus = session?.recorderStatus ?? null;

        if (session?.applyFlow) {
          applyJob = {
            id: session.jobId,
            companyName: session.companyName,
            title: session.jobTitle,
            jdUrl: session.jdUrl,
            resumeFolderName: session.resumeSetFolder,
          };
        } else if (tabId) {
          const apply = await ApplyLifecycle.getByTabId(tabId);
          if (apply?.job) {
            applyJob = apply.job;
            recorderStatus = apply.recorderStatus ?? 'ready';
            session = {
              resumeSetFolder: apply.job.resumeFolderName,
              applyFlow: true,
              pending: true,
              error: apply.error ?? null,
            };
          }
        }

        sendResponse({
          ok: true,
          session,
          auth,
          applyJob,
          recorderStatus,
          error: session?.error ?? null,
        });
        break;
      }

      case 'RESUME_SELECTED': {
        const session = await getSessionForTab(sender.tab?.id);
        if (!session || session.status !== 'recording') {
          sendResponse({ ok: false });
          break;
        }

        const payload = message.payload || {};
        if (payload.sessionId && String(payload.sessionId) !== String(session.id)) {
          sendResponse({ ok: false, staleSession: true });
          break;
        }
        const originalName =
          payload.originalName || payload.originalFileName || null;
        const cleanedName = payload.cleanedName || payload.submittedFileName || null;
        const auditKey = String(
          payload.auditKey ||
            [
              session.id,
              originalName || '',
              cleanedName || '',
              Number(payload.fileSize) || 0,
              payload.mimeType || '',
            ].join('|'),
        );
        const event = {
          ...payload,
          sessionId: session.id,
          auditKey,
          recordedAt: new Date().toISOString(),
          pageUrl: sender.tab?.url ?? payload.pageUrl,
          pageTitle: sender.tab?.title ?? payload.pageTitle,
          sessionResumeSetFolder: session.resumeSetFolder || null,
          expectedName:
            payload.expectedName || session.expectedResumeName || null,
        };

        const isDuplicate = (session.resumeEvents || []).some(
          (existingEvent) => existingEvent?.auditKey === auditKey,
        );

        if (!isDuplicate) {
          await updateSession(session.id, (s) => ({
            ...s,
            resumeEvents: [...(s.resumeEvents ?? []), event],
          }));
        }

        // Persist audit to Athens (original vs canonical expected).
        try {
          const auth = await MockApi.getAuth();
          const jobId = session.jobId || null;
          const settings = await AthensApi.getSettings();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          if (!isDuplicate && applierName && jobId && originalName) {
            await AthensApi.saveResumeAudit(applierName, {
              jobId,
              originalName,
              expectedName: event.expectedName,
              cleanedName,
              renamed: Boolean(payload.renamed),
              company: session.companyName,
              title: session.jobTitle,
              pageUrl: event.pageUrl,
              sessionId: session.id,
              source: payload.source,
              fileSize: Number(payload.fileSize),
              lastModified: Number(payload.lastModified),
              mimeType: payload.mimeType,
              auditKey,
            });
          }
        } catch (err) {
          console.warn('Bid Monitor: resume audit failed', err);
        }

        sendResponse({
          ok: true,
          duplicate: isDuplicate,
          mismatch: Boolean(event.mismatch),
        });
        break;
      }

      case 'SHOW_TOAST': {
        const tabId = sender.tab?.id;
        const text = String(message.message || '').trim();
        if (tabId != null && text) {
          chrome.tabs
            .sendMessage(tabId, { type: 'SHOW_TOAST', message: text }, { frameId: 0 })
            .catch(() => {});
        }
        sendResponse({ ok: true });
        break;
      }

      case 'GET_REJECTED_BIDS': {
        try {
          const auth = await MockApi.getAuth();
          const settings = await AthensApi.getSettings();
          // profileName is a slug (eli-taylor); Athens APIs need display applierName.
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          if (!applierName) {
            sendResponse({ ok: false, error: 'Sign in required.' });
            break;
          }
          const results = await AthensApi.fetchRejectedBids(
            applierName,
            settings.apiUrl,
          );
          sendResponse({ ok: true, results });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || String(err) });
        }
        break;
      }

      case 'MARK_BID_FIXED': {
        try {
          const auth = await MockApi.getAuth();
          const settings = await AthensApi.getSettings();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          if (!applierName) {
            sendResponse({ ok: false, error: 'Sign in required.' });
            break;
          }
          const jobId = String(message.jobId || message.id || '').trim();
          if (!jobId) {
            sendResponse({ ok: false, error: 'jobId is required.' });
            break;
          }
          const data = await AthensApi.markBidFixed(applierName, { jobId });
          sendResponse({ ok: true, result: data.result || null });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || String(err) });
        }
        break;
      }

      case 'DOWNLOAD_RESUMES_ZIP': {
        try {
          const auth = await MockApi.getAuth();
          const settings = await AthensApi.getSettings();
          const applierName =
            settings.applierName || auth?.applierName || auth?.displayName || '';
          if (!applierName) {
            sendResponse({ ok: false, error: 'Sign in required.' });
            break;
          }
          const jobIds = Array.isArray(message.jobIds) ? message.jobIds : [];
          const { blob, fileName } = await AthensApi.fetchResumesZip(applierName, jobIds);
          const safeZip = sanitizeResumeDownloadName(fileName.replace(/\.zip$/i, '')) || 'bid-resumes';
          await downloadBlobAsFile(blob, `bid-monitor/resumes/${safeZip}.zip`);
          sendResponse({ ok: true, fileName: `${safeZip}.zip` });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || String(err) });
        }
        break;
      }

      case 'EXPORT_SESSION': {
        // Local export removed — recordings live in Firebase / Bid Management.
        sendResponse({
          ok: false,
          error: 'Local session export is disabled. Recordings upload to Firebase on Submit.',
        });
        break;
      }

      case 'CLEAR_SESSIONS': {
        await saveSessions([]);
        await SessionVideoStore.clearAll();
        updateBadge(false);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })().catch((err) => {
    console.error(err);
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

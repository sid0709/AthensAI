/**
 * Job-scoped apply sessions. Tabs are indexes only — closing a résumé/PDF
 * tab must not wipe the active apply.
 */
const ApplyLifecycle = (() => {
  const APPLIES_KEY = 'activeAppliesByJobId';
  const TAB_INDEX_KEY = 'applyTabIndex';

  async function getAll() {
    const { [APPLIES_KEY]: applies = {} } = await chrome.storage.local.get(APPLIES_KEY);
    return applies && typeof applies === 'object' ? applies : {};
  }

  async function getTabIndex() {
    const { [TAB_INDEX_KEY]: index = {} } = await chrome.storage.local.get(TAB_INDEX_KEY);
    return index && typeof index === 'object' ? index : {};
  }

  async function saveAll(applies) {
    await chrome.storage.local.set({ [APPLIES_KEY]: applies });
  }

  async function saveTabIndex(index) {
    await chrome.storage.local.set({ [TAB_INDEX_KEY]: index });
  }

  function jobKey(jobId) {
    return String(jobId || '').trim();
  }

  async function getByJobId(jobId) {
    const key = jobKey(jobId);
    if (!key) return null;
    const applies = await getAll();
    return applies[key] || null;
  }

  async function getByTabId(tabId) {
    if (tabId == null) return null;
    const index = await getTabIndex();
    const jobId = index[String(tabId)];
    if (jobId) {
      const apply = await getByJobId(jobId);
      if (apply) return apply;
    }
    // Fallback: scan applies for applyTabId match.
    const applies = await getAll();
    for (const apply of Object.values(applies)) {
      if (Number(apply.applyTabId) === Number(tabId)) return apply;
    }
    return null;
  }

  async function linkTab(jobId, tabId, { exclusive = false } = {}) {
    const key = jobKey(jobId);
    if (!key || tabId == null) return;
    const index = await getTabIndex();
    if (exclusive) {
      // Legacy single-tab mode: drop other index entries for this job.
      for (const [tid, jid] of Object.entries(index)) {
        if (String(jid) === key) delete index[tid];
      }
    }
    index[String(tabId)] = key;
    await saveTabIndex(index);
  }

  async function linkAdditionalTab(jobId, tabId) {
    return linkTab(jobId, tabId, { exclusive: false });
  }

  async function unlinkTab(tabId) {
    if (tabId == null) return;
    const index = await getTabIndex();
    if (!index[String(tabId)]) return;
    delete index[String(tabId)];
    await saveTabIndex(index);
  }

  async function upsert(jobId, partial) {
    const key = jobKey(jobId);
    if (!key) throw new Error('jobId required');
    const applies = await getAll();
    const prev = applies[key] || {};
    const next = {
      ...prev,
      ...partial,
      jobId: key,
      athensJobId: String(partial.athensJobId || prev.athensJobId || key),
      updatedAt: new Date().toISOString(),
      startedAt: prev.startedAt || partial.startedAt || new Date().toISOString(),
    };
    if (partial.job) next.job = { ...(prev.job || {}), ...partial.job };
    if (partial.analysis !== undefined) next.analysis = partial.analysis;
    // Keep activeTabIds in sync with applyTabId for multi-tab sessions.
    if (partial.applyTabId != null) {
      const tabs = [...(next.activeTabIds || [])];
      if (!tabs.map(Number).includes(Number(partial.applyTabId))) {
        tabs.push(partial.applyTabId);
      }
      next.activeTabIds = tabs;
    }
    if (partial.activeTabIds !== undefined) {
      next.activeTabIds = partial.activeTabIds;
    }
    if (partial.applicationSessionId !== undefined) {
      next.applicationSessionId = partial.applicationSessionId;
    }
    applies[key] = next;
    await saveAll(applies);
    if (next.applyTabId != null) {
      await linkTab(key, next.applyTabId, { exclusive: false });
    }
    return next;
  }

  async function setAnalysis(jobId, analysis) {
    return upsert(jobId, {
      analysis: {
        ...analysis,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async function clearApplyTabOnly(tabId) {
    const apply = await getByTabId(tabId);
    await unlinkTab(tabId);
    if (!apply) return null;
    const remaining = (apply.activeTabIds || []).filter((id) => Number(id) !== Number(tabId));
    const wasPrimary = Number(apply.applyTabId) === Number(tabId);
    return upsert(apply.jobId, {
      activeTabIds: remaining,
      applyTabId: wasPrimary ? (remaining[0] ?? null) : apply.applyTabId,
      recorderStatus:
        apply.recorderStatus === 'recording' || apply.recorderStatus === 'paused'
          ? apply.recorderStatus
          : apply.recorderStatus === 'starting'
            ? 'ready'
            : apply.recorderStatus || 'ready',
    });
  }

  async function remove(jobId) {
    const key = jobKey(jobId);
    if (!key) return;
    const applies = await getAll();
    const apply = applies[key];
    if (!apply) return;
    delete applies[key];
    await saveAll(applies);
    if (apply.applyTabId != null) await unlinkTab(apply.applyTabId);
    for (const tid of apply.activeTabIds || []) {
      await unlinkTab(tid);
    }
    const index = await getTabIndex();
    let dirty = false;
    for (const [tid, jid] of Object.entries(index)) {
      if (String(jid) === key) {
        delete index[tid];
        dirty = true;
      }
    }
    if (dirty) await saveTabIndex(index);
  }

  async function resolveActiveApply() {
    const applies = await getAll();
    const list = Object.values(applies).sort((a, b) => {
      const aTime = new Date(a.updatedAt || 0).getTime();
      const bTime = new Date(b.updatedAt || 0).getTime();
      return bTime - aTime;
    });

    for (const apply of list) {
      if (apply.applyTabId != null) {
        try {
          await chrome.tabs.get(apply.applyTabId);
          return apply;
        } catch {
          // Tab gone — keep job session, clear tab id.
          await upsert(apply.jobId, { applyTabId: null });
        }
      }
    }

    // Prefer most recently updated session even without a live tab (reopen UX).
    return list[0] || null;
  }

  /**
   * Compatibility shape for older SW paths that keyed by tabId.
   * Only includes applies that still have an applyTabId.
   */
  async function toPendingTabsShape() {
    const applies = await getAll();
    const pending = {};
    for (const apply of Object.values(applies)) {
      if (apply.applyTabId == null || !apply.job) continue;
      pending[apply.applyTabId] = {
        profileName: apply.bidderName || apply.profileName || '',
        recorderStatus: apply.recorderStatus || 'ready',
        poolId: apply.poolId,
        job: apply.job,
        streamId: apply.streamId ?? null,
        streamIdCapturedAt: apply.streamIdCapturedAt ?? null,
        error: apply.error ?? null,
        updatedAt: apply.updatedAt,
        jobId: apply.jobId,
        analysis: apply.analysis || null,
      };
    }
    return pending;
  }

  async function setPendingForTab(tabId, data) {
    const jobId = jobKey(data?.job?.id || data?.jobId);
    if (!jobId) return;
    await upsert(jobId, {
      applyTabId: tabId,
      poolId: data.poolId,
      job: data.job,
      bidderName: data.profileName,
      profileName: data.profileName,
      recorderStatus: data.recorderStatus || 'ready',
      streamId: data.streamId ?? null,
      streamIdCapturedAt: data.streamIdCapturedAt ?? null,
      error: data.error ?? null,
      athensStatus: 'in_process',
    });
  }

  async function clearPendingForTab(tabId) {
    // Legacy name: used to delete the whole pending entry. Now only clears tab link
    // unless removeJob is requested via finish flows (use remove()).
    return clearApplyTabOnly(tabId);
  }

  return {
    APPLIES_KEY,
    getAll,
    getByJobId,
    getByTabId,
    upsert,
    setAnalysis,
    clearApplyTabOnly,
    remove,
    resolveActiveApply,
    toPendingTabsShape,
    setPendingForTab,
    clearPendingForTab,
    linkTab,
    linkAdditionalTab,
    unlinkTab,
    getTabIndex,
  };
})();

/**
 * Bid Ready queue fetch, cache, and résumé enrichment.
 * Local apply/finish status wins over stale Athens snapshots so badges don't flicker.
 */
const QueueSync = (() => {
  const CACHE_KEY = 'bidReadyCache';
  const FINISHED_KEY = 'bidReadyFinishedJobs';
  const CACHE_TTL_MS = 30000;
  const FINISHED_TTL_MS = 15 * 60 * 1000;
  let inFlight = null;
  let lastFetchStartedAt = 0;

  async function readCache() {
    const { [CACHE_KEY]: cache = null } = await chrome.storage.local.get(CACHE_KEY);
    return cache;
  }

  async function readFinished() {
    const { [FINISHED_KEY]: finished = {} } = await chrome.storage.local.get(FINISHED_KEY);
    if (!finished || typeof finished !== 'object') return {};
    const now = Date.now();
    let dirty = false;
    const next = {};
    for (const [id, entry] of Object.entries(finished)) {
      const at = entry?.at ? new Date(entry.at).getTime() : 0;
      if (!at || now - at > FINISHED_TTL_MS) {
        dirty = true;
        continue;
      }
      next[id] = entry;
    }
    if (dirty) await chrome.storage.local.set({ [FINISHED_KEY]: next });
    return next;
  }

  async function writeFinished(finished) {
    await chrome.storage.local.set({ [FINISHED_KEY]: finished });
  }

  function jobMatchesId(job, id) {
    const target = String(id);
    return String(job.id) === target || String(job.athensJobId || '') === target;
  }

  function collectJobIds(job) {
    const ids = new Set();
    if (job?.id != null) ids.add(String(job.id));
    if (job?.athensJobId != null) ids.add(String(job.athensJobId));
    return ids;
  }

  function isTerminalStatus(status) {
    return status === 'applied' || status === 'skipped';
  }

  function isFinishedId(finished, job) {
    for (const id of collectJobIds(job)) {
      const entry = finished[id];
      if (entry && isTerminalStatus(entry.status)) return true;
    }
    return false;
  }

  /**
   * Align with Athens Bid Management:
   * - Pending until Apply
   * - Active apply session → In process (local override until Athens catches up)
   * - Submitted / Skipped leave the Bid Monitor queue
   */
  async function mergeLocalOverrides(pools) {
    const applies =
      typeof ApplyLifecycle !== 'undefined' ? await ApplyLifecycle.getAll() : {};
    const finished = await readFinished();

    const inProcessIds = new Set();
    for (const apply of Object.values(applies || {})) {
      for (const id of collectJobIds({
        id: apply.jobId,
        athensJobId: apply.athensJobId,
      })) {
        inProcessIds.add(id);
      }
    }

    return (pools || []).map((pool) => ({
      ...pool,
      jobs: (pool.jobs || [])
        .filter((job) => !isTerminalStatus(job.status) && !isFinishedId(finished, job))
        .map((job) => {
          // Normalize legacy cache values.
          let status = job.status === 'not_applied' || !job.status ? 'pending' : job.status;
          const isActiveApply = [...collectJobIds(job)].some((id) => inProcessIds.has(id));
          if (isActiveApply) {
            status = 'in_process';
          } else if (status === 'in_process' && !job.bidderInProcess) {
            // Downgrade stale/false In process (e.g. old Avalon progress===active mapping).
            status = 'pending';
          }
          return status === job.status ? job : { ...job, status };
        }),
    }));
  }

  async function writeCache({ auth, pools, athensError, source }) {
    const mergedPools = await mergeLocalOverrides(pools || []);
    const payload = {
      auth: auth || null,
      pools: mergedPools,
      athensError: athensError || null,
      source: source || 'athens',
      updatedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [CACHE_KEY]: payload });
    return payload;
  }

  async function patchJobStatus(jobId, status) {
    const cache = await readCache();
    if (!cache?.pools?.length || !jobId) return cache;
    const id = String(jobId);
    let changed = false;
    const pools = cache.pools.map((pool) => ({
      ...pool,
      jobs: (pool.jobs || []).map((job) => {
        if (!jobMatchesId(job, id)) return job;
        if (job.status === 'applied' || job.status === 'skipped') return job;
        changed = true;
        return { ...job, status };
      }),
    }));
    if (!changed) return cache;
    return writeCache({ ...cache, pools });
  }

  /**
   * After Submit/Skip: record terminal status and remove from Bid Monitor queue
   * (same as Athens — ticket leaves Bid Ready / In process).
   */
  async function markJobFinished(jobId, status, jobSnapshot = null) {
    if (!jobId || !isTerminalStatus(status)) return null;
    const id = String(jobId);
    const cache = await readCache();
    let snapshot = jobSnapshot;
    if (!snapshot && cache?.pools) {
      for (const pool of cache.pools) {
        const found = (pool.jobs || []).find((job) => jobMatchesId(job, id));
        if (found) {
          snapshot = found;
          break;
        }
      }
    }

    const finished = await readFinished();
    const ids = collectJobIds(snapshot || { id, athensJobId: id });
    const entry = {
      status,
      at: new Date().toISOString(),
      job: snapshot ? { ...snapshot, status } : { id, athensJobId: id, status },
    };
    for (const jid of ids) finished[jid] = entry;
    await writeFinished(finished);

    if (!cache?.pools?.length) {
      return writeCache({
        auth: cache?.auth || null,
        pools: [],
        athensError: cache?.athensError || null,
        source: cache?.source || 'athens',
      });
    }

    const pools = cache.pools.map((pool) => ({
      ...pool,
      jobs: (pool.jobs || []).filter(
        (job) => !jobMatchesId(job, id) && ![...ids].some((jid) => jobMatchesId(job, jid)),
      ),
    }));
    return writeCache({ ...cache, pools });
  }

  async function removeJobFromCache(jobId) {
    return markJobFinished(jobId, 'applied');
  }

  async function enrichResumeStatus(pools, applierName) {
    const jobs = [];
    for (const pool of pools || []) {
      for (const job of pool.jobs || []) jobs.push(job);
    }
    const resumeJobIds = [
      ...new Set(jobs.map((j) => j.athensJobId || j.id).filter(Boolean).map(String)),
    ];
    if (!resumeJobIds.length || !applierName) return pools;

    let withResume = new Set();
    try {
      withResume = await AthensApi.checkGeneratedResumes(applierName, resumeJobIds, {
        timeoutMs: 15000,
      });
    } catch (err) {
      console.warn('Bid Monitor: résumé status check failed', err);
      return pools;
    }

    return (pools || []).map((pool) => ({
      ...pool,
      jobs: (pool.jobs || []).map((job) => {
        const rid = String(job.athensJobId || job.id);
        return { ...job, hasGeneratedResume: withResume.has(rid) };
      }),
    }));
  }

  /** Merge résumé flags onto the latest cache so we don't rewind statuses. */
  async function mergeResumeFlagsOntoLatest(enrichedPools) {
    const latest = await readCache();
    const flagById = new Map();
    for (const pool of enrichedPools || []) {
      for (const job of pool.jobs || []) {
        for (const id of collectJobIds(job)) {
          flagById.set(id, Boolean(job.hasGeneratedResume));
        }
      }
    }
    const basePools = latest?.pools?.length ? latest.pools : enrichedPools;
    return (basePools || []).map((pool) => ({
      ...pool,
      jobs: (pool.jobs || []).map((job) => {
        const flag = [...collectJobIds(job)]
          .map((id) => flagById.get(id))
          .find((v) => v !== undefined);
        if (flag === undefined) return job;
        return { ...job, hasGeneratedResume: flag };
      }),
    }));
  }

  async function fetchDashboardState({ useCache = true, enrichResumes = true } = {}) {
    if (inFlight) return inFlight;

    lastFetchStartedAt = Date.now();
    inFlight = (async () => {
      const auth = await AuthSession.getAuth();
      if (!auth) {
        return { ok: true, auth: null, pools: [], athensError: null, source: null, fromCache: false };
      }

      const settings = await AthensApi.getSettings();
      const applierName = settings.applierName || auth.applierName || auth.displayName;
      const nextAuth = { ...auth, applierName, role: 'bidder', source: 'athens' };

      if (!applierName) {
        return {
          ok: true,
          auth: nextAuth,
          pools: [],
          athensError: 'Set an Athens applier name to load Bid Ready jobs.',
          source: 'athens',
          fromCache: false,
        };
      }

      try {
        let pools = await AthensApi.fetchBidReadyPools(applierName, settings.apiUrl, {
          includeResumeStatus: false,
          timeoutMs: 15000,
        });

        const written = await writeCache({
          auth: nextAuth,
          pools,
          athensError: null,
          source: 'athens',
        });

        const result = {
          ok: true,
          auth: nextAuth,
          pools: written.pools,
          athensError: null,
          source: 'athens',
          fromCache: false,
        };

        if (enrichResumes) {
          enrichResumeStatus(pools, applierName)
            .then(async (enriched) => {
              const latestAuth = await AuthSession.getAuth();
              if (!latestAuth) return;
              const merged = await mergeResumeFlagsOntoLatest(enriched);
              await writeCache({
                auth: nextAuth,
                pools: merged,
                athensError: null,
                source: 'athens',
              });
              chrome.runtime.sendMessage({ type: 'QUEUE_ENRICHED' }).catch(() => {});
            })
            .catch((err) => console.warn('Bid Monitor: résumé enrich failed', err));
        }

        return result;
      } catch (err) {
        const cached = useCache ? await readCache() : null;
        if (cached?.pools?.length) {
          const pools = await mergeLocalOverrides(cached.pools);
          return {
            ok: true,
            auth: nextAuth,
            pools,
            athensError: err instanceof Error ? err.message : String(err),
            source: 'athens',
            fromCache: true,
          };
        }
        return {
          ok: true,
          auth: nextAuth,
          pools: [
            {
              id: 'athens-bid-ready',
              name: 'Bid Ready',
              status: 'active',
              profileName: applierName,
              source: 'athens',
              jobs: [],
            },
          ],
          athensError: err instanceof Error ? err.message : String(err),
          source: 'athens',
          fromCache: false,
        };
      }
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  function cacheIsFresh(cached) {
    if (!cached?.updatedAt) return false;
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    return Number.isFinite(age) && age < CACHE_TTL_MS;
  }

  async function getCachedOrFetch() {
    const auth = await AuthSession.getAuth();
    if (!auth) {
      return { ok: true, auth: null, pools: [], athensError: null, source: null, fromCache: false };
    }
    const cached = await readCache();
    if (cached?.pools) {
      const pools = await mergeLocalOverrides(cached.pools);
      const fresh = cacheIsFresh(cached);
      const alreadyFetching = Boolean(inFlight);
      // Only refresh when stale and idle — avoids the preferCache → writeCache → reload loop.
      let refreshing = false;
      if (!fresh && !alreadyFetching) {
        refreshing = true;
        fetchDashboardState({ useCache: true, enrichResumes: true }).catch(() => {});
      } else if (alreadyFetching && Date.now() - lastFetchStartedAt < CACHE_TTL_MS) {
        refreshing = true;
      }
      return {
        ok: true,
        auth: { ...auth, ...(cached.auth || {}) },
        pools,
        athensError: cached.athensError || null,
        source: cached.source || 'athens',
        fromCache: true,
        refreshing,
      };
    }
    return fetchDashboardState({ useCache: true, enrichResumes: true });
  }

  return {
    CACHE_KEY,
    FINISHED_KEY,
    readCache,
    writeCache,
    patchJobStatus,
    markJobFinished,
    removeJobFromCache,
    enrichResumeStatus,
    fetchDashboardState,
    getCachedOrFetch,
    mergeLocalOverrides,
  };
})();

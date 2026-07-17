/**
 * Athens-only session + Bid Ready queue for Bid-Monitor.
 * Auth is fast (AuthSession); queue loads via QueueSync.
 */
const MockApi = (() => {
  async function getAuth() {
    return AuthSession.getAuth();
  }

  async function signIn(username, password, options = {}) {
    return AuthSession.signIn(username, password, options);
  }

  async function signOut() {
    await chrome.storage.local.remove([QueueSync.CACHE_KEY, QueueSync.FINISHED_KEY]);
    return AuthSession.signOut();
  }

  async function getDashboardState(options = {}) {
    if (options.preferCache) {
      return QueueSync.getCachedOrFetch();
    }
    return QueueSync.fetchDashboardState({
      useCache: options.useCache !== false,
      enrichResumes: options.enrichResumes !== false,
    });
  }

  function findPool(pools, poolId) {
    return pools.find((pool) => pool.id === poolId) ?? null;
  }

  function findJob(pool, jobId) {
    return pool?.jobs?.find((job) => job.id === jobId) ?? null;
  }

  return {
    signIn,
    signOut,
    getAuth,
    getDashboardState,
    findPool,
    findJob,
    getPoolsForProfile: async () => [],
    markJobApplied: async () => null,
    resetActiveJobs: async () => ({ ok: false, error: 'Demo reset removed — use Athens Bid Ready.' }),
    getPoolDownloadEntries: () => [],
    getUniqueResumeFolders: () => [],
    getMockCredentialsHint: () => ({ profiles: [], ownerPassword: '', bidderPassword: '' }),
  };
})();

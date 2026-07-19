const SessionVideoStore = (() => {
  const DB_NAME = 'BidMonitorVideos';
  const DB_VERSION = 2;
  const STORE = 'videos';

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // keyPath stays sessionId for backward compat; we store segmentIds in the same field.
          db.createObjectStore(STORE, { keyPath: 'sessionId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function save(sessionId, blob, metadata = {}) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        sessionId,
        blob,
        mimeType: metadata.mimeType ?? blob.type ?? 'video/webm',
        videoFormat: metadata.videoFormat ?? null,
        savedAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Alias — segments use the same store keyed by segmentId. */
  async function saveSegment(segmentId, blob, metadata = {}) {
    return save(segmentId, blob, metadata);
  }

  async function get(sessionId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(sessionId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function getSegment(segmentId) {
    return get(segmentId);
  }

  async function deleteSession(sessionId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteSegment(segmentId) {
    return deleteSession(segmentId);
  }

  async function clearAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load segment blobs and stitch into one final video.
   * @param {Array<{ segmentId: string, startedAt?: string }>} segments
   */
  async function stitchSegments(segments) {
    const records = [];
    for (const seg of segments || []) {
      const stored = await getSegment(seg.segmentId || seg.videoBlobKey);
      if (!stored?.blob || stored.blob.size === 0) continue;
      records.push({
        segmentId: seg.segmentId,
        startedAt: seg.startedAt,
        blob: stored.blob,
        mimeType: stored.mimeType || stored.blob.type || 'video/webm',
      });
    }
    return SegmentStitch.buildFinalVideoFromSegments(records);
  }

  return {
    save,
    get,
    delete: deleteSession,
    clearAll,
    saveSegment,
    getSegment,
    deleteSegment,
    stitchSegments,
  };
})();

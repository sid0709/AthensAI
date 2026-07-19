/**
 * Pure ordering and safe single-blob fallback helpers.
 * Multi-file re-encoding runs in the offscreen document; independent WebM/MP4
 * files must never be concatenated as raw bytes.
 */
const SegmentStitch = (() => {
  function orderByStartedAt(segments) {
    if (!Array.isArray(segments)) return [];
    return [...segments].sort((a, b) => {
      const aTime = new Date(a.startedAt || 0).getTime();
      const bTime = new Date(b.startedAt || 0).getTime();
      return aTime - bTime;
    });
  }

  /**
   * Return a blob only when there is exactly one independent recording.
   * Multiple container files require a real re-encode/remux.
   */
  function stitchSegmentBlobs(blobs, mimeType = 'video/webm') {
    const usable = (blobs || []).filter((b) => b && typeof b.size === 'number' && b.size > 0);
    if (!usable.length) return null;
    if (usable.length !== 1) return null;
    return usable[0] instanceof Blob ? usable[0] : new Blob([usable[0]], { type: mimeType });
  }

  /**
   * @param {Array<{ segmentId: string, startedAt?: string, blob?: Blob, mimeType?: string }>} segmentRecords
   * @returns {{ blob: Blob|null, mimeType: string, segmentIds: string[], usedFallback: boolean }}
   */
  function buildFinalVideoFromSegments(segmentRecords) {
    const ordered = orderByStartedAt(segmentRecords || []).filter((r) => r?.blob && r.blob.size > 0);
    if (!ordered.length) {
      return { blob: null, mimeType: 'video/webm', segmentIds: [], usedFallback: false };
    }

    const mimeType = ordered[0].mimeType || ordered[0].blob.type || 'video/webm';
    if (ordered.length > 1) {
      return {
        blob: ordered[0].blob,
        mimeType,
        segmentIds: [ordered[0].segmentId],
        usedFallback: true,
      };
    }

    return {
      blob: ordered[0].blob,
      mimeType,
      segmentIds: [ordered[0].segmentId],
      usedFallback: false,
    };
  }

  return {
    orderByStartedAt,
    stitchSegmentBlobs,
    buildFinalVideoFromSegments,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SegmentStitch };
}

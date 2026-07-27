const DUPLICATE_PROJECTION = {
  postedAt: 1,
  _createdAt: 1,
  createdAt: 1,
};

function timestamp(job) {
  for (const value of [job?.postedAt, job?._createdAt, job?.createdAt]) {
    if (!value) continue;
    const millis = new Date(value).getTime();
    if (Number.isFinite(millis)) return millis;
  }
  return 0;
}

export function newestDuplicate(candidates = []) {
  return [...candidates].sort((left, right) =>
    timestamp(right) - timestamp(left) ||
    String(right?._id || '').localeCompare(String(left?._id || '')),
  )[0] || null;
}

/**
 * Keep Firestore queries indexable: a broad `$or` forces the compatibility
 * adapter to scan the entire collection. Two exact lookups stay bounded.
 */
export async function findDuplicateByUrl(collection, urlCandidates, duplicateScope = {}) {
  const urls = [...new Set((urlCandidates || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!collection || !urls.length) return null;
  const [applyLinkMatches, urlMatches] = await Promise.all([
    collection.find(
      { ...duplicateScope, applyLink: { $in: urls } },
      { projection: DUPLICATE_PROJECTION },
    ).toArray(),
    collection.find(
      { ...duplicateScope, url: { $in: urls } },
      { projection: DUPLICATE_PROJECTION },
    ).toArray(),
  ]);
  const byId = new Map(
    [...applyLinkMatches, ...urlMatches].map((job) => [String(job?._id || ''), job]),
  );
  return newestDuplicate([...byId.values()]);
}

function uniqueIds(values = []) {
  return [...new Set(values.map((value) => String(value ?? '')).filter(Boolean))];
}

/** Fraction of the ideal top-k that appeared anywhere in the retrieved candidate set. */
export function recallAtK(candidateIds, idealIds, k = 100) {
  const ideal = uniqueIds(idealIds).slice(0, Math.max(0, k));
  if (!ideal.length) return 1;
  const candidates = new Set(uniqueIds(candidateIds));
  return ideal.filter((id) => candidates.has(id)).length / ideal.length;
}

function gain(relevance) {
  const normalized = Math.max(0, Number(relevance) || 0) / 100;
  return (2 ** normalized) - 1;
}

function dcg(rows) {
  return rows.reduce((sum, row, index) => sum + gain(row.relevance) / Math.log2(index + 2), 0);
}

/** NDCG using the exhaustive score as graded relevance (0..100). */
export function ndcgAtK(rankedIds, idealRows, k = 100) {
  const limit = Math.max(0, k);
  const relevanceById = new Map(
    idealRows.map((row) => [String(row.id), Math.max(0, Number(row.relevance) || 0)]),
  );
  const actual = uniqueIds(rankedIds).slice(0, limit)
    .map((id) => ({ id, relevance: relevanceById.get(id) || 0 }));
  while (actual.length < Math.min(limit, relevanceById.size)) {
    actual.push({ id: '', relevance: 0 });
  }
  const ideal = [...relevanceById.entries()]
    .map(([id, relevance]) => ({ id, relevance }))
    .sort((left, right) => right.relevance - left.relevance || right.id.localeCompare(left.id))
    .slice(0, limit);
  const idealDcg = dcg(ideal);
  return idealDcg === 0 ? 1 : dcg(actual) / idealDcg;
}

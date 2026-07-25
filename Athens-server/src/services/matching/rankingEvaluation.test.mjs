import test from 'node:test';
import assert from 'node:assert/strict';
import { ndcgAtK, recallAtK } from './rankingEvaluation.js';

test('recall@k checks ideal results against the complete candidate set', () => {
  assert.equal(recallAtK(['a', 'c', 'x'], ['a', 'b', 'c'], 3), 2 / 3);
  assert.equal(recallAtK([], [], 100), 1);
});

test('ndcg@k is one for ideal order and penalizes inversions', () => {
  const ideal = [
    { id: 'a', relevance: 100 },
    { id: 'b', relevance: 80 },
    { id: 'c', relevance: 20 },
  ];
  assert.equal(ndcgAtK(['a', 'b', 'c'], ideal, 3), 1);
  assert.ok(ndcgAtK(['c', 'b', 'a'], ideal, 3) < 1);
});

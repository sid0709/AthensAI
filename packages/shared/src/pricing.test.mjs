import { toCanonical, normalizeSkillSet } from './skill-normalize.js';
import { costFromUsage } from './pricing.js';
import test from 'node:test';
import assert from 'node:assert/strict';

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeCoverageScore(jobSkills, profileSkills) {
  const jobSet = jobSkills instanceof Set ? jobSkills : normalizeSkillSet(jobSkills);
  const profileSet = profileSkills instanceof Set ? profileSkills : normalizeSkillSet(profileSkills);
  const required = jobSet.size;
  if (required === 0) return { matchScore: 0, covered: [], missing: [], required: 0 };
  const covered = [];
  const missing = [];
  for (const skill of jobSet) {
    if (profileSet.has(skill)) covered.push(skill);
    else missing.push(skill);
  }
  return {
    matchScore: clampScore((covered.length / required) * 100),
    covered,
    missing,
    required,
  };
}

test('toCanonical resolves aliases', () => {
  assert.equal(toCanonical('TDD'), 'test-driven development');
  assert.equal(toCanonical('Node.js'), 'node.js');
  assert.equal(toCanonical('TypeScript'), 'typescript');
});

test('coverage score is asymmetric containment', () => {
  const job = ['typescript', 'react', 'node.js'];
  const profile = new Set([
    ...normalizeSkillSet(['typescript', 'react', 'node.js', 'python', 'java', 'aws']),
  ]);
  const r = computeCoverageScore(job, profile);
  assert.equal(r.matchScore, 100);
  assert.equal(r.covered.length, 3);
});

test('partial coverage', () => {
  const r = computeCoverageScore(['typescript', 'react', 'kubernetes'], ['typescript']);
  assert.equal(r.matchScore, 33);
});

test('deepseek cache hit pricing', () => {
  const u = costFromUsage('deepseek-v4-flash', {
    prompt_cache_hit_tokens: 1_000_000,
    prompt_cache_miss_tokens: 10_000,
    completion_tokens: 5_000,
  });
  assert.ok(u.costUsd < 0.01);
  assert.equal(u.cachedTokens, 1_000_000);
});

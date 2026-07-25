import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileCompacts } from '@nextoffer/shared/skill-match';
import { buildProfileTokens, skillTokens } from '@nextoffer/shared/skill-tokens';
import { compactSkillText } from '@nextoffer/shared/skill-compact';
import { exactRerankCandidates } from './exactRerank.js';

function context(skills) {
  const tokenWeights = {};
  const compactWeights = [];
  for (const skill of skills) {
    for (const token of skillTokens(skill)) tokenWeights[token] = 1;
    compactWeights.push({ c: compactSkillText(skill), w: 1 });
  }
  return {
    profileTokens: buildProfileTokens(skills),
    profileCompacts: buildProfileCompacts(skills),
    exactSet: new Set(skills.map((skill) => skill.toLowerCase())),
    tokenWeights,
    compactWeights,
  };
}

test('exact reranker is authoritative over sparse candidate order', () => {
  const candidates = [
    { jobId: 'a', sparseScore: 99, payload: { postedAt: '2026-01-01', aiSkills: [{ name: 'Java', category: 'hard', requirement: 5 }] } },
    { jobId: 'b', sparseScore: 10, payload: { postedAt: '2026-01-02', aiSkills: [{ name: 'React', category: 'hard', requirement: 5 }] } },
  ];
  const ranked = exactRerankCandidates(candidates, context(['React']), {}, 10);
  assert.equal(ranked[0].jobId, 'b');
  assert.equal(ranked[0].exactScore, 100);
});

test('exact reranker reuses proficiency matches without changing scores', () => {
  const profile = context(['React']);
  const candidates = [
    { jobId: 'one', sparseScore: 90, payload: { aiSkills: ['React', 'Node.js'] } },
    { jobId: 'two', sparseScore: 80, payload: { aiSkills: ['React', 'PostgreSQL'] } },
  ];
  const rows = exactRerankCandidates(candidates, profile);
  assert.deepEqual(rows.map((row) => row.exactScore), [50, 50]);
});

test('compact ranking skill tuples preserve exact coverage', () => {
  const ranked = exactRerankCandidates([
    { jobId: 'tuple', payload: { rankSkills: [['React', 0, 5], ['Node.js', 0, 5]] } },
  ], context(['React']));
  assert.equal(ranked[0].exactScore, 50);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobSkillSparseVector,
  buildUserSkillSparseVector,
  stableSkillId,
} from './canonicalSkillVectors.js';

test('stable skill ids are deterministic unsigned integers', () => {
  assert.equal(stableSkillId('Node.js'), stableSkillId('node.js'));
  assert.notEqual(stableSkillId('Node.js'), stableSkillId('React'));
  assert.ok(stableSkillId('React') > 0);
});

test('job sparse vectors deduplicate aliases and normalize the denominator', () => {
  const vector = buildJobSkillSparseVector([
    { name: 'React', category: 'hard', requirement: 2 },
    { name: 'react', category: 'hard', requirement: 5 },
    { name: 'AWS', category: 'devops', requirement: 3 },
  ]);
  assert.equal(vector.indices.length, 2);
  assert.ok(Math.abs(vector.values.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  assert.equal(vector.skills.find((skill) => skill.canonical === 'react')?.requirement, 5);
});

test('user sparse vectors retain the strongest proficiency', () => {
  const vector = buildUserSkillSparseVector([
    { name: 'React', level: 2 },
    { name: 'react', level: 5 },
    { name: 'AWS', level: 3 },
  ]);
  assert.equal(vector.indices.length, 2);
  const reactIndex = vector.indices.indexOf(stableSkillId('react'));
  assert.equal(vector.values[reactIndex], 1);
});

test('user sparse vectors expand asymmetric skill families from the dictionary', () => {
  const vector = buildUserSkillSparseVector(
    [{ name: 'React', level: 5 }],
    [{ name: 'React Native', nameCanonical: 'react native', skillId: stableSkillId('react native') }],
  );
  assert.ok(vector.indices.includes(stableSkillId('react native')));
});

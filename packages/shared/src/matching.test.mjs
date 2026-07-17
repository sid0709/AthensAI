import test from 'node:test';
import assert from 'node:assert/strict';
import { compactSkillText } from './skill-compact.js';
import { skillTokens, buildProfileTokens } from './skill-tokens.js';
import { jobSkillMatchesProfile, jobSkillMatchWeight, buildProfileCompacts } from './skill-match.js';
import { extractSkillsFromTitle, enrichJobSkillsFromTitle } from '../../../Athens-server/src/services/matching/jobSkillExtraction.js';
import { computeHybridScore, computeCoverageScore } from '../../../Athens-server/src/services/matching/coverageScore.js';

test('extractSkillsFromTitle pulls technology tokens, skips role filler', () => {
  const skills = extractSkillsFromTitle('Senior Salesforce Developer (m/f/d)');
  assert.ok(skills.some((s) => s.toLowerCase() === 'salesforce'));
  assert.equal(skills.some((s) => s.toLowerCase() === 'developer'), false);
  assert.equal(skills.some((s) => s.toLowerCase() === 'senior'), false);
});

test('extractSkillsFromTitle works for non-engineering titles', () => {
  const skills = extractSkillsFromTitle('Marketing Manager — HubSpot');
  assert.ok(skills.some((s) => s.toLowerCase() === 'marketing'));
  assert.ok(skills.some((s) => s.toLowerCase() === 'hubspot'));
});

test('enrichJobSkillsFromTitle adds title skill to job list', () => {
  const { skills, skillsNormalized } = enrichJobSkillsFromTitle({
    title: 'Salesforce Developer',
    skills: ['Java', 'SQL', 'REST APIs'],
  });
  assert.ok(skills.some((s) => /salesforce/i.test(s)));
  assert.ok(skillsNormalized.includes('salesforce'));
});

function profileCtx(skills) {
  return {
    profileTokens: buildProfileTokens(skills),
    profileCompacts: buildProfileCompacts(skills),
  };
}

test('shared word token matches related job skills', () => {
  assert.ok(jobSkillMatchesProfile('software development', profileCtx(['Software'])));
  assert.ok(jobSkillMatchesProfile('MFC C++', profileCtx(['C++'])));
  assert.equal(compactSkillText('full-stack'), 'fullstack');
});

test('>=5 substring shim keeps fullstack <-> full-stack development', () => {
  assert.ok(jobSkillMatchesProfile('full-stack development', profileCtx(['fullstack'])));
});

test('profile AI matches AI-family job skills by word, not by blob', () => {
  const ctx = profileCtx(['AI']);
  assert.ok(jobSkillMatchesProfile('AI', ctx));
  assert.ok(jobSkillMatchesProfile('AI/ML System', ctx));
  assert.ok(jobSkillMatchesProfile('AI-driven Solutions', ctx));
  assert.ok(jobSkillMatchesProfile('AI/ML-powered Systems', ctx));
});

test('profile AI does NOT match unrelated skills containing the letters "ai"', () => {
  const ctx = profileCtx(['AI']);
  assert.equal(jobSkillMatchesProfile('Gmail', ctx), false);
  assert.equal(jobSkillMatchesProfile('Training', ctx), false);
  assert.equal(jobSkillMatchesProfile('Maintenance', ctx), false);
});

test('skillTokens splits on separators but preserves c++/node.js', () => {
  assert.deepEqual(skillTokens('AI/ML Model'), ['ai', 'ml', 'model']);
  assert.deepEqual(skillTokens('AI-driven Workflows'), ['ai', 'driven']); // "workflows" is generic filler
  assert.ok(skillTokens('MFC C++').includes('c++'));
  assert.ok(skillTokens('Node.js').includes('node.js'));
});

test('generic filler tokens are dropped, distinctive ones kept', () => {
  // "development"/"systems" are filler; the real noun survives
  assert.deepEqual(skillTokens('Backend Development'), ['backend']);
  assert.deepEqual(skillTokens('Distributed Systems'), ['distributed']);
  // distinctive words are NOT filtered
  assert.ok(skillTokens('UI Design').includes('design'));
  assert.ok(skillTokens('Cloud Data').includes('data'));
});

test('generic word alone does not cross-match unrelated roles', () => {
  const ctx = profileCtx(['React', 'Frontend Development', 'UI Design']);
  // shares only the filler "development" with the job → must NOT match
  assert.equal(jobSkillMatchesProfile('Backend Development', ctx), false);
  // but a real shared word still matches
  assert.ok(jobSkillMatchesProfile('React Native', ctx));
});

test('single-char language skills match by word, never by substring', () => {
  const ctx = profileCtx(['C']);
  assert.ok(jobSkillMatchesProfile('C Programming', ctx));
  assert.ok(jobSkillMatchesProfile('Embedded C', ctx));
  assert.equal(jobSkillMatchesProfile('Calculation', ctx), false);
  // c++ / c# are distinct tokens, not the C language
  assert.equal(jobSkillMatchesProfile('C++', ctx), false);
  assert.equal(jobSkillMatchesProfile('C#', ctx), false);

  const rCtx = profileCtx(['R']);
  assert.ok(jobSkillMatchesProfile('R Studio', rCtx));
  assert.equal(jobSkillMatchesProfile('Ruby', rCtx), false);

  // non-allowlisted single letters stay dropped
  assert.deepEqual(skillTokens('Plan B'), ['plan']);
  assert.deepEqual(skillTokens('C Programming'), ['c']);
});

test('React profile activates the React word family', () => {
  const ctx = profileCtx(['React']);
  assert.ok(jobSkillMatchesProfile('React Native', ctx));
  assert.ok(jobSkillMatchesProfile('React.js', ctx)); // via >=5 compact shim
});

test('jobSkillMatchWeight returns best matching weight via word tokens', () => {
  const ctx = {
    tokenWeights: { react: 1.0, mentoring: 0.38, aws: 0.85, c: 0.9 },
    compactWeights: [{ c: 'react', w: 1.0 }],
  };
  assert.equal(jobSkillMatchWeight('React Native', ctx), 1.0);
  assert.equal(jobSkillMatchWeight('React.js', ctx), 1.0); // compact shim carries the weight
  assert.equal(jobSkillMatchWeight('Mentoring', ctx), 0.38);
  assert.equal(jobSkillMatchWeight('AWS Lambda', ctx), 0.85);
  assert.equal(jobSkillMatchWeight('C Programming', ctx), 0.9);
  assert.equal(jobSkillMatchWeight('Calculation', ctx), 0);
  assert.equal(jobSkillMatchWeight('Kubernetes', ctx), 0);
});

test('jobSkillMatchWeight compact shim never fires for short skills', () => {
  const ctx = { tokenWeights: {}, compactWeights: [{ c: 'ai', w: 1.0 }, { c: 'c', w: 1.0 }] };
  assert.equal(jobSkillMatchWeight('Gmail', ctx), 0);
  assert.equal(jobSkillMatchWeight('Calculation', ctx), 0);
});

test('requirement-weighted coverage: perfect candidate scores exactly 100 (no suppression)', () => {
  const aiSkills = [
    { name: 'React', category: 'hard', requirement: 5 },
    { name: 'Mentoring', category: 'soft', requirement: 2 },
  ];
  // Proficiency-only maps (category applied job-side); max proficiency = 1.0
  const perfect = { tokenWeights: { react: 1.0, mentoring: 1.0 }, compactWeights: [{ c: 'react', w: 1.0 }] };
  assert.equal(computeCoverageScore(aiSkills, perfect).matchScore, 100);

  // Only the mandatory hard skill covered → still high (hard req5 dominates)
  const reactOnly = { tokenWeights: { react: 1.0 }, compactWeights: [{ c: 'react', w: 1.0 }] };
  const s1 = computeCoverageScore(aiSkills, reactOnly).matchScore;
  assert.ok(s1 >= 80 && s1 < 100, `expected high not perfect, got ${s1}`);

  // Only the soft nice-to-have covered → low (mandatory hard gap dominates)
  const softOnly = { tokenWeights: { mentoring: 0.76 }, compactWeights: [] };
  const s2 = computeCoverageScore(aiSkills, softOnly).matchScore;
  assert.ok(s2 < 20, `expected low, got ${s2}`);
  assert.ok(s1 > s2);
});

test('computeHybridScore blends skill and vector scores', () => {
  assert.equal(computeHybridScore(100, 0, { skill: 0.55, vector: 0.45 }), 55);
  assert.equal(computeHybridScore(0, 100, { skill: 0.55, vector: 0.45 }), 45);
  assert.equal(computeHybridScore(100, 100, { skill: 0.55, vector: 0.45 }), 100);
});

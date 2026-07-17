import { jobsCollection } from '../../db/mongo.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { normalizeSkillSet, toCanonical } from '@nextoffer/shared/skill-normalize';
import { skillTokens } from '@nextoffer/shared/skill-tokens';

const SKILL_INDEX_PREFIX = 'skill:';
const TOKEN_INDEX_PREFIX = 'tok:';
const JOB_SKILLS_PREFIX = 'job:skills:';
const JOB_TOKENS_PREFIX = 'job:tokens:';
const JOB_COUNT_PREFIX = 'job:skillcount:';

export function normalizeJobSkills(skills = []) {
  return [...normalizeSkillSet(skills)];
}

/**
 * Flatten raw (display) job skills into a unique list of word tokens.
 * Tokens are taken from the RAW skill text so separators are preserved
 * (`AI/ML System` → ['ai','ml','system']); using skillsNormalized here would
 * collapse `AI/ML` into `aiml` and lose the split.
 */
export function jobSkillTokens(skills = []) {
  const set = new Set();
  for (const s of skills) {
    for (const token of skillTokens(s)) set.add(token);
  }
  return [...set];
}

/** Persist skillsNormalized + skillTokens on a job document fields object. */
export function attachNormalizedSkills(job) {
  const skills = Array.isArray(job.skills) ? job.skills : [];
  const skillsNormalized = normalizeJobSkills(skills);
  const skillTokensList = jobSkillTokens(skills);
  return { ...job, skills, skillsNormalized, skillTokens: skillTokensList };
}

/**
 * Index one job in Redis: canonical inverted index (`skill:`) + word-token
 * inverted index (`tok:`). All writes are pipelined in a single round-trip.
 */
export async function indexJobInRedis(jobId, skillsNormalized = [], skillTokensList = []) {
  if (!isRedisReady() || !jobId) return;
  const redis = getRedis();
  const id = String(jobId);

  const [prevSkillsRaw, prevTokensRaw] = await Promise.all([
    redis.get(`${JOB_SKILLS_PREFIX}${id}`),
    redis.get(`${JOB_TOKENS_PREFIX}${id}`),
  ]);

  const multi = redis.multi();

  if (prevSkillsRaw) {
    try {
      for (const s of JSON.parse(prevSkillsRaw)) multi.sRem(`${SKILL_INDEX_PREFIX}${s}`, id);
    } catch { /* ignore */ }
  }
  if (prevTokensRaw) {
    try {
      for (const t of JSON.parse(prevTokensRaw)) multi.sRem(`${TOKEN_INDEX_PREFIX}${t}`, id);
    } catch { /* ignore */ }
  }

  const skills = Array.isArray(skillsNormalized) ? skillsNormalized : [];
  const tokens = Array.isArray(skillTokensList) ? skillTokensList : [];

  if (!skills.length && !tokens.length) {
    multi.del(`${JOB_SKILLS_PREFIX}${id}`, `${JOB_COUNT_PREFIX}${id}`, `${JOB_TOKENS_PREFIX}${id}`);
    await multi.exec();
    return;
  }

  multi.set(`${JOB_SKILLS_PREFIX}${id}`, JSON.stringify(skills));
  multi.set(`${JOB_COUNT_PREFIX}${id}`, String(skills.length));
  multi.set(`${JOB_TOKENS_PREFIX}${id}`, JSON.stringify(tokens));
  for (const skill of skills) multi.sAdd(`${SKILL_INDEX_PREFIX}${skill}`, id);
  for (const token of tokens) multi.sAdd(`${TOKEN_INDEX_PREFIX}${token}`, id);

  await multi.exec();
}

export async function removeJobFromRedisIndex(jobId) {
  if (!isRedisReady() || !jobId) return;
  const redis = getRedis();
  const id = String(jobId);

  const [prevSkillsRaw, prevTokensRaw] = await Promise.all([
    redis.get(`${JOB_SKILLS_PREFIX}${id}`),
    redis.get(`${JOB_TOKENS_PREFIX}${id}`),
  ]);

  const multi = redis.multi();
  if (prevSkillsRaw) {
    try {
      for (const s of JSON.parse(prevSkillsRaw)) multi.sRem(`${SKILL_INDEX_PREFIX}${s}`, id);
    } catch { /* ignore */ }
  }
  if (prevTokensRaw) {
    try {
      for (const t of JSON.parse(prevTokensRaw)) multi.sRem(`${TOKEN_INDEX_PREFIX}${t}`, id);
    } catch { /* ignore */ }
  }
  multi.del(`${JOB_SKILLS_PREFIX}${id}`, `${JOB_COUNT_PREFIX}${id}`, `${JOB_TOKENS_PREFIX}${id}`);
  await multi.exec();
}

/**
 * Collect candidate job IDs whose skills share at least one word token with the
 * profile — a single `SUNION` over the token index (same rule used for scoring,
 * so containment-only matches like profile "AI" → job "AI-driven Solutions" are
 * no longer dropped before scoring).
 */
export async function findCandidateJobIds(profileTokens) {
  if (!isRedisReady()) return null;
  const tokens = profileTokens instanceof Set
    ? [...profileTokens]
    : (Array.isArray(profileTokens) ? profileTokens : []);
  if (!tokens.length) return null;

  const redis = getRedis();
  const keys = tokens.map((t) => `${TOKEN_INDEX_PREFIX}${t}`);
  const ids = await redis.sUnion(keys);
  return new Set(ids);
}

/**
 * Get normalized skills for a job from Redis or null.
 */
export async function getJobSkillsFromRedis(jobId) {
  if (!isRedisReady()) return null;
  const raw = await getRedis().get(`${JOB_SKILLS_PREFIX}${String(jobId)}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Full rebuild of Redis index from Mongo (maintenance script).
 */
export async function rebuildSkillIndex({ batchSize = 500 } = {}) {
  if (!jobsCollection) throw new Error('MongoDB not ready');
  if (!isRedisReady()) throw new Error('Redis not ready');

  const redis = getRedis();
  for (const prefix of [SKILL_INDEX_PREFIX, TOKEN_INDEX_PREFIX, JOB_SKILLS_PREFIX, JOB_TOKENS_PREFIX, JOB_COUNT_PREFIX]) {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(keys);
  }

  let processed = 0;
  const cursor = jobsCollection.find(
    { $or: [{ skillsNormalized: { $exists: true, $ne: [] } }, { skills: { $exists: true, $ne: [] } }] },
    { projection: { skillsNormalized: 1, skillTokens: 1, skills: 1 } },
  );

  const indexDoc = async (job) => {
    const skillsNormalized = Array.isArray(job.skillsNormalized) && job.skillsNormalized.length
      ? job.skillsNormalized
      : normalizeJobSkills(job.skills || []);
    const tokens = Array.isArray(job.skillTokens) && job.skillTokens.length
      ? job.skillTokens
      : jobSkillTokens(job.skills || []);
    await indexJobInRedis(String(job._id), skillsNormalized, tokens);
  };

  let batch = [];
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= batchSize) {
      for (const job of batch) await indexDoc(job);
      processed += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    for (const job of batch) await indexDoc(job);
    processed += batch.length;
  }
  return { processed };
}

export { toCanonical, normalizeSkillSet };

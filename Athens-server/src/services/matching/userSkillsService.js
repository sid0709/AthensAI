import { userSkillsCollection } from '../../db/mongo.js';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import {
  USER_SKILL_CATEGORIES,
  USER_SKILL_LEVEL_MIN,
  USER_SKILL_LEVEL_MAX,
  computeUserSkillWeight,
} from '../../config/graphAndVectorConfig.js';
import { invalidateProfileSkillCache } from './profileSkills.js';
import { getRedis, isRedisReady } from '../../db/redis.js';

/**
 * Manual user skills — the sole source for match scoring. Each skill carries a
 * category (hard/soft/devops/tools/domain) and level (1-5). Every mutation
 * funnels through invalidateProfileSkillCache, which bumps the query ranking
 * version or queues the legacy materialized rescore.
 */

export const DEFAULT_SKILL_CATEGORY = 'hard';
export const DEFAULT_SKILL_LEVEL = 3;
const SKILL_DOCS_CACHE_TTL_SEC = 60 * 60;
const skillDocLoads = new Map();

function skillDocsCacheKey(applierName) {
  return `profile:skill-docs:${String(applierName || '').trim()}`;
}

async function clearSkillDocsCache(applierName) {
  if (isRedisReady()) await getRedis().del(skillDocsCacheKey(applierName));
}

function normalizeCategory(category) {
  const c = String(category || '').trim().toLowerCase();
  return USER_SKILL_CATEGORIES.includes(c) ? c : null;
}

function normalizeLevel(level) {
  const n = Number.parseInt(String(level ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(USER_SKILL_LEVEL_MAX, Math.max(USER_SKILL_LEVEL_MIN, n));
}

function presentSkill(doc) {
  return {
    name: doc.name,
    category: doc.category,
    level: doc.level,
    weight: computeUserSkillWeight(doc.category, doc.level),
  };
}

export async function listUserSkills(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !userSkillsCollection) return [];
  const docs = await loadUserSkillDocs(name);
  return [...docs]
    .sort((left, right) =>
      String(left.category || '').localeCompare(String(right.category || '')) ||
      Number(right.level || 0) - Number(left.level || 0) ||
      String(left.name || '').localeCompare(String(right.name || '')),
    )
    .map(presentSkill);
}

/** Upsert one skill: adding an existing skill updates its category/level. */
export async function upsertUserSkill(applierName, { name, category, level } = {}) {
  const owner = String(applierName || '').trim();
  const label = String(name || '').trim();
  if (!owner || !label) throw new Error('applierName and skill name are required');
  if (!userSkillsCollection) throw new Error('Database not ready');

  const cat = normalizeCategory(category) ?? DEFAULT_SKILL_CATEGORY;
  const lv = normalizeLevel(level) ?? DEFAULT_SKILL_LEVEL;
  const canonical = toCanonical(label) || label.toLowerCase();
  const now = new Date().toISOString();

  await userSkillsCollection.updateOne(
    { applierName: owner, nameCanonical: canonical },
    {
      $set: { name: label, category: cat, level: lv, updatedAt: now },
      $setOnInsert: { applierName: owner, nameCanonical: canonical, createdAt: now },
    },
    { upsert: true },
  );

  await clearSkillDocsCache(owner);
  await invalidateProfileSkillCache(owner);
  return { skills: await listUserSkills(owner) };
}

export async function removeUserSkill(applierName, skillName) {
  const owner = String(applierName || '').trim();
  const label = String(skillName || '').trim();
  if (!owner || !label) throw new Error('applierName and skill name are required');
  if (!userSkillsCollection) throw new Error('Database not ready');

  const canonical = toCanonical(label) || label.toLowerCase();
  const res = await userSkillsCollection.deleteOne({
    applierName: owner,
    nameCanonical: canonical,
  });

  if (res.deletedCount > 0) {
    await clearSkillDocsCache(owner);
    await invalidateProfileSkillCache(owner);
  }
  return { removed: res.deletedCount > 0, skills: await listUserSkills(owner) };
}

/** Raw docs for the profile-context builder (no weight rounding, no sort). */
export async function loadUserSkillDocs(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !userSkillsCollection) return [];
  const existing = skillDocLoads.get(name);
  if (existing) return existing;
  const load = (async () => {
    if (isRedisReady()) {
      const cached = await getRedis().get(skillDocsCacheKey(name));
      if (cached) {
        try {
          const docs = JSON.parse(cached);
          await getRedis().expire(skillDocsCacheKey(name), SKILL_DOCS_CACHE_TTL_SEC);
          return docs;
        } catch { /* reload */ }
      }
    }
    const docs = await userSkillsCollection
      .find({ applierName: name }, { projection: { name: 1, category: 1, level: 1 } })
      .toArray();
    if (isRedisReady()) {
      await getRedis().setEx(skillDocsCacheKey(name), SKILL_DOCS_CACHE_TTL_SEC, JSON.stringify(docs));
    }
    return docs;
  })();
  skillDocLoads.set(name, load);
  try {
    return await load;
  } finally {
    if (skillDocLoads.get(name) === load) skillDocLoads.delete(name);
  }
}

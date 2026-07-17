import { userSkillsCollection } from '../../db/mongo.js';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import {
  USER_SKILL_CATEGORIES,
  USER_SKILL_LEVEL_MIN,
  USER_SKILL_LEVEL_MAX,
  computeUserSkillWeight,
} from '../../config/graphAndVectorConfig.js';
import { invalidateProfileSkillCache } from './profileSkills.js';

/**
 * Manual user skills — the sole source for match scoring. Each skill carries a
 * category (hard/soft/devops/tools/domain) and level (1-5); the two combine
 * into a 0..1 weight consumed by the weighted coverage scorer. Every mutation
 * funnels through invalidateProfileSkillCache, which queues a background
 * rescore of the user's materialized job scores.
 */

export const DEFAULT_SKILL_CATEGORY = 'hard';
export const DEFAULT_SKILL_LEVEL = 3;

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
  const docs = await userSkillsCollection
    .find({ applierName: name })
    .sort({ category: 1, level: -1, name: 1 })
    .toArray();
  return docs.map(presentSkill);
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
    await invalidateProfileSkillCache(owner);
  }
  return { removed: res.deletedCount > 0, skills: await listUserSkills(owner) };
}

/** Raw docs for the profile-context builder (no weight rounding, no sort). */
export async function loadUserSkillDocs(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !userSkillsCollection) return [];
  return userSkillsCollection
    .find({ applierName: name }, { projection: { name: 1, category: 1, level: 1 } })
    .toArray();
}

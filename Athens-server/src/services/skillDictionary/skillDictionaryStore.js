import { skillDictionaryCollection } from '../../db/dataStore.js';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { skillTokens } from '@nextoffer/shared/skill-tokens';
import { USER_SKILL_CATEGORIES } from '../../config/graphAndVectorConfig.js';
import { stableSkillId } from '../matching/canonicalSkillVectors.js';
import {
  publishCanonicalSkillDictionaryChange,
} from '../matching/canonicalSkillDictionary.js';

/**
 * Global, deduped dictionary of every skill seen in a job description.
 *
 * Writes are FULLY ATOMIC — no read-modify-write. Concurrent extractors that
 * hit the same skill (e.g. "React") each issue an independent $inc, so nothing
 * is lost. Averages and the dominant category are derived at read time from the
 * cumulative counters, never stored pre-computed.
 */

function categoryOf(entry) {
  const counts = entry?.categoryCounts || {};
  let best = 'hard';
  let bestN = -1;
  for (const cat of USER_SKILL_CATEGORIES) {
    const n = counts[cat] || 0;
    if (n > bestN) {
      bestN = n;
      best = cat;
    }
  }
  return best;
}

export function presentDictionaryEntry(entry) {
  const jobCount = entry.jobCount || 0;
  return {
    name: entry.name,
    nameCanonical: entry.nameCanonical,
    category: categoryOf(entry),
    jobCount,
    requirementAvg: jobCount ? Number(((entry.requirementSum || 0) / jobCount).toFixed(2)) : 0,
  };
}

export function aggregateJobSkillBatches(skillLists = []) {
  const aggregated = new Map();
  for (const aiSkills of skillLists) {
    const perJob = new Map();
    for (const skill of Array.isArray(aiSkills) ? aiSkills : []) {
      const name = String(skill?.name || '').trim();
      if (!name) continue;
      const canonical = toCanonical(name) || name.toLowerCase();
      const category = USER_SKILL_CATEGORIES.includes(skill?.category) ? skill.category : 'hard';
      const requirement = Math.min(5, Math.max(1, Number(skill?.requirement) || 1));
      const existing = perJob.get(canonical);
      if (!existing || requirement > existing.requirement) {
        perJob.set(canonical, { name: existing?.name || name, canonical, category, requirement });
      }
    }
    for (const skill of perJob.values()) {
      const { name, canonical, category, requirement } = skill;
      const entry = aggregated.get(canonical) || {
        name,
        canonical,
        jobCount: 0,
        requirementSum: 0,
        categoryCounts: {},
      };
      entry.jobCount += 1;
      entry.requirementSum += requirement;
      entry.categoryCounts[category] = (entry.categoryCounts[category] || 0) + 1;
      aggregated.set(canonical, entry);
    }
  }
  return [...aggregated.values()];
}

/** Atomically fold many jobs' AI skills into the dictionary in one bulk write. */
export async function recordJobSkillBatches(skillLists = []) {
  if (!skillDictionaryCollection || !skillLists.length) return;
  const now = new Date().toISOString();
  const aggregated = aggregateJobSkillBatches(skillLists);
  const changedEntries = aggregated.map(({ name, canonical }) => ({
    name,
    nameCanonical: canonical,
    skillId: stableSkillId(canonical),
  }));
  const ops = aggregated.map((entry) => ({
    updateOne: {
      filter: { nameCanonical: entry.canonical },
      update: {
        $setOnInsert: {
          nameCanonical: entry.canonical,
          name: entry.name,
          skillId: stableSkillId(entry.canonical),
          createdAt: now,
        },
        $set: { lastSeenAt: now },
        $inc: {
          jobCount: entry.jobCount,
          requirementSum: entry.requirementSum,
          ...Object.fromEntries(
            Object.entries(entry.categoryCounts).map(([category, count]) => [`categoryCounts.${category}`, count]),
          ),
        },
        $addToSet: { tokens: { $each: skillTokens(entry.name) } },
      },
      upsert: true,
    },
  }));
  if (ops.length) {
    const result = typeof skillDictionaryCollection.atomicBulkUpsert === 'function'
      ? await skillDictionaryCollection.atomicBulkUpsert(ops)
      : await skillDictionaryCollection.bulkWrite(ops, { ordered: false });
    if (Number(result?.upsertedCount) > 0) {
      await publishCanonicalSkillDictionaryChange(changedEntries);
    }
  }
}

/** Atomically fold one job's AI skills into the dictionary. */
export async function recordJobSkills(aiSkills = []) {
  return recordJobSkillBatches([aiSkills]);
}

/**
 * Autocomplete. Prefix mode (default) rides the unique nameCanonical B-tree;
 * contains mode does token infix via the multikey {tokens:1} index.
 */
export async function searchDictionary(query, { limit = 20, mode = 'prefix' } = {}) {
  if (!skillDictionaryCollection) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    const top = await skillDictionaryCollection.find({}).sort({ jobCount: -1 }).limit(limit).toArray();
    return top.map(presentDictionaryEntry);
  }

  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let filter;
  if (mode === 'contains') {
    // Match any word token of the query against the token index.
    const tokens = skillTokens(q);
    filter = tokens.length ? { tokens: { $in: tokens } } : { nameCanonical: new RegExp(esc) };
  } else {
    filter = { nameCanonical: new RegExp(`^${esc}`) };
  }

  const rows = await skillDictionaryCollection
    .find(filter)
    .sort({ jobCount: -1 })
    .limit(limit)
    .toArray();
  return rows.map(presentDictionaryEntry);
}

/** How many distinct dictionary skills a user skill (word-containment) covers. */
export async function countCoveredSkills(skillName) {
  if (!skillDictionaryCollection) return 0;
  const tokens = skillTokens(skillName);
  if (!tokens.length) return 0;
  return skillDictionaryCollection.countDocuments({ tokens: { $in: tokens } });
}

export async function clearDictionary() {
  if (!skillDictionaryCollection) return { deleted: 0 };
  const res = await skillDictionaryCollection.deleteMany({});
  await publishCanonicalSkillDictionaryChange();
  return { deleted: res.deletedCount };
}

import { skillDictionaryCollection } from '../../db/mongo.js';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { skillTokens } from '@nextoffer/shared/skill-tokens';
import { USER_SKILL_CATEGORIES } from '../../config/graphAndVectorConfig.js';

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

/** Atomically fold one job's AI skills into the dictionary. */
export async function recordJobSkills(aiSkills = []) {
  if (!skillDictionaryCollection || !aiSkills.length) return;
  const now = new Date().toISOString();
  const ops = [];
  const seen = new Set();
  for (const s of aiSkills) {
    const name = String(s?.name || '').trim();
    if (!name) continue;
    const canonical = toCanonical(name) || name.toLowerCase();
    if (seen.has(canonical)) continue; // one increment per job per skill
    seen.add(canonical);
    const category = USER_SKILL_CATEGORIES.includes(s?.category) ? s.category : 'hard';
    const requirement = Math.min(5, Math.max(1, Number(s?.requirement) || 1));
    ops.push({
      updateOne: {
        filter: { nameCanonical: canonical },
        update: {
          $setOnInsert: { nameCanonical: canonical, name, createdAt: now },
          $set: { lastSeenAt: now },
          $inc: {
            jobCount: 1,
            requirementSum: requirement,
            [`categoryCounts.${category}`]: 1,
          },
          $addToSet: { tokens: { $each: skillTokens(name) } },
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await skillDictionaryCollection.bulkWrite(ops, { ordered: false });
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
  return { deleted: res.deletedCount };
}

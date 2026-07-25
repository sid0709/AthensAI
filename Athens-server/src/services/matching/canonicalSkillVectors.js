import crypto from 'node:crypto';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { getSkillCategoryWeights, skillLevelFactor } from '../../config/graphAndVectorConfig.js';
import { buildProfileCompacts, matchProficiency } from '@nextoffer/shared/skill-match';
import { buildProfileTokens, skillTokens } from '@nextoffer/shared/skill-tokens';
import { compactSkillText } from '@nextoffer/shared/skill-compact';

/** Stable unsigned 32-bit sparse-vector index. Collisions are rejected by the dictionary snapshot. */
export function stableSkillId(name) {
  const canonical = toCanonical(String(name || '').trim()) || String(name || '').trim().toLowerCase();
  if (!canonical) return null;
  const value = crypto.createHash('sha256').update(canonical).digest().readUInt32BE(0);
  return value === 0 ? 1 : value;
}

function sortedSparse(entries) {
  const rows = [...entries.entries()].sort((a, b) => a[0] - b[0]);
  return {
    indices: rows.map(([id]) => id),
    values: rows.map(([, value]) => value),
  };
}

/** Deduplicate aliases by canonical id and keep the strongest requirement contribution. */
export function buildJobSkillSparseVector(aiSkills = []) {
  const categoryWeights = getSkillCategoryWeights();
  const byId = new Map();
  const normalizedSkills = new Map();

  for (const raw of Array.isArray(aiSkills) ? aiSkills : []) {
    const name = typeof raw === 'string' ? raw : String(raw?.name || '');
    const canonical = toCanonical(name) || name.trim().toLowerCase();
    const id = stableSkillId(canonical);
    if (!canonical || id == null) continue;
    const category = typeof raw === 'object' && raw?.category ? raw.category : 'hard';
    const requirement = Math.min(5, Math.max(1, Number(typeof raw === 'object' ? raw?.requirement : 1) || 1));
    const categoryWeight = Number(categoryWeights[category] ?? categoryWeights.hard ?? 1);
    const contribution = requirement * categoryWeight;
    if ((byId.get(id) ?? -1) < contribution) {
      byId.set(id, contribution);
      normalizedSkills.set(id, { name: name.trim(), canonical, category, requirement });
    }
  }

  const denominator = [...byId.values()].reduce((sum, value) => sum + value, 0);
  if (denominator <= 0) return { indices: [], values: [], skills: [] };
  const weighted = new Map([...byId].map(([id, value]) => [id, value / denominator]));
  return { ...sortedSparse(weighted), skills: [...normalizedSkills.values()] };
}

/** Deduplicate profile aliases and keep the highest proficiency for each canonical skill. */
export function buildUserSkillSparseVector(skillDocs = [], dictionaryEntries = []) {
  const byId = new Map();
  const names = [];
  const tokenWeights = {};
  const compactWeightMap = new Map();
  for (const raw of Array.isArray(skillDocs) ? skillDocs : []) {
    const name = String(raw?.name || '').trim();
    const id = stableSkillId(name);
    if (!name || id == null) continue;
    names.push(name);
    const proficiency = skillLevelFactor(raw?.level);
    if ((byId.get(id) ?? -1) < proficiency) byId.set(id, proficiency);
    for (const token of skillTokens(name)) {
      if ((tokenWeights[token] ?? -1) < proficiency) tokenWeights[token] = proficiency;
    }
    const compact = compactSkillText(name);
    if (compact && (compactWeightMap.get(compact) ?? -1) < proficiency) {
      compactWeightMap.set(compact, proficiency);
    }
  }

  if (dictionaryEntries.length && names.length) {
    const ctx = {
      profileTokens: buildProfileTokens(names),
      profileCompacts: buildProfileCompacts(names),
      tokenWeights,
      compactWeights: [...compactWeightMap].map(([c, w]) => ({ c, w })),
    };
    for (const entry of dictionaryEntries) {
      const name = String(entry.name || entry.nameCanonical || '').trim();
      const id = Number(entry.skillId) || stableSkillId(entry.nameCanonical || name);
      if (!name || id == null) continue;
      const proficiency = matchProficiency(name, ctx);
      if (proficiency > (byId.get(id) ?? 0)) byId.set(id, proficiency);
    }
  }
  return sortedSparse(byId);
}

export function dictionaryVersionFor(entries = []) {
  const canonical = entries
    .map((entry) => `${entry.nameCanonical || ''}:${entry.skillId ?? stableSkillId(entry.nameCanonical) ?? ''}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

import { userSkillsCollection } from '../../db/mongo.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { normalizeSkillSet } from '@nextoffer/shared/skill-normalize';
import { buildProfileCompacts } from '@nextoffer/shared/skill-match';
import { buildProfileTokens, skillTokens } from '@nextoffer/shared/skill-tokens';
import { compactSkillText } from '@nextoffer/shared/skill-compact';
import { skillLevelFactor } from '../../config/graphAndVectorConfig.js';
import { requestUserRescore } from './matchScoreStore.js';

const PROFILE_CACHE_TTL_SEC = 180;
const profileKey = (applierName) => `profile:skills:${String(applierName || '').trim()}`;
const matchContextKey = (applierName) => `profile:match:${String(applierName || '').trim()}`;

/**
 * The profile match context is built SOLELY from manual user skills
 * (user_skills collection) — resume-derived skills no longer participate.
 * Besides the boolean matching surfaces (tokens/compacts), the context carries
 * per-token and per-compact weights (category weight × level factor) consumed
 * by the weighted coverage scorer.
 */
function buildContextFromSkillDocs(skillDocs) {
  const names = [];
  const tokenWeights = {};
  const compactWeightMap = new Map();

  for (const doc of skillDocs) {
    const label = String(doc?.name || '').trim();
    if (!label) continue;
    names.push(label);
    // The maps carry the user's PROFICIENCY factor only (0..1). Category weight
    // is applied job-side at score time (the job skill's category is the
    // authoritative requirement type), so it must not be baked in here.
    const weight = skillLevelFactor(doc.level);
    if (weight <= 0) continue;

    for (const token of skillTokens(label)) {
      if (!(token in tokenWeights) || tokenWeights[token] < weight) {
        tokenWeights[token] = weight;
      }
    }
    const compact = compactSkillText(label);
    if (compact && compact.length >= 2) {
      const prev = compactWeightMap.get(compact);
      if (prev === undefined || prev < weight) compactWeightMap.set(compact, weight);
    }
  }

  const profileCompacts = buildProfileCompacts(names);
  const ctx = {
    exactSet: normalizeSkillSet(names),
    profileCompacts,
    boostCompacts: profileCompacts,
    profileTokens: buildProfileTokens(names),
    tokenWeights,
    compactWeights: [...compactWeightMap.entries()].map(([c, w]) => ({ c, w })),
    boostRaw: names,
  };
  return ctx;
}

/**
 * Load union of canonical skills (exact match layer).
 */
export async function loadProfileSkillSet(applierName) {
  const ctx = await loadProfileMatchContext(applierName);
  return ctx.exactSet;
}

/**
 * Weighted match context from the user's manual skill list, Redis-cached.
 */
export async function loadProfileMatchContext(applierName) {
  const name = String(applierName || '').trim();
  if (!name) {
    return buildContextFromSkillDocs([]);
  }

  if (isRedisReady()) {
    const redis = getRedis();
    const cached = await redis.get(matchContextKey(name));
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return {
          exactSet: new Set(parsed.exactSet || []),
          profileCompacts: parsed.profileCompacts || [],
          boostCompacts: parsed.profileCompacts || [],
          profileTokens: parsed.profileTokens || [],
          tokenWeights: parsed.tokenWeights || {},
          compactWeights: parsed.compactWeights || [],
          boostRaw: parsed.boostRaw || [],
        };
      } catch {
        /* rebuild */
      }
    }
  }

  const skillDocs = userSkillsCollection
    ? await userSkillsCollection
        .find({ applierName: name }, { projection: { name: 1, category: 1, level: 1 } })
        .toArray()
    : [];
  const ctx = buildContextFromSkillDocs(skillDocs);

  if (isRedisReady()) {
    const redis = getRedis();
    const payload = JSON.stringify({
      exactSet: [...ctx.exactSet],
      profileCompacts: ctx.profileCompacts,
      profileTokens: ctx.profileTokens,
      tokenWeights: ctx.tokenWeights,
      compactWeights: ctx.compactWeights,
      boostRaw: ctx.boostRaw,
    });
    await redis.setEx(matchContextKey(name), PROFILE_CACHE_TTL_SEC, payload);
    await redis.setEx(profileKey(name), PROFILE_CACHE_TTL_SEC, JSON.stringify([...ctx.exactSet]));
  }

  return ctx;
}

/** Drop the Redis-cached profile context only (no rescore side effects). */
export async function clearProfileSkillCache(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !isRedisReady()) return;
  const redis = getRedis();
  await redis.del(profileKey(name), matchContextKey(name));
}

/**
 * Single funnel for "this user's skills changed". Queues a full
 * materialized-score rebuild for the user — deliberately before the Redis
 * guard inside clearProfileSkillCache, so the rescore is requested even when
 * Redis is down.
 */
export async function invalidateProfileSkillCache(applierName) {
  const name = String(applierName || '').trim();
  if (!name) return;
  await requestUserRescore(name);
  await clearProfileSkillCache(name);
}

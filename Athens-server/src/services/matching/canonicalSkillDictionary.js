import { skillDictionaryCollection } from '../../db/dataStore.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { dictionaryVersionFor, stableSkillId } from './canonicalSkillVectors.js';
import { skillTokens } from '@nextoffer/shared/skill-tokens';

const SNAPSHOT_TTL_MS = 5 * 60_000;
const DICTIONARY_REVISION_KEY = 'ranking:v2:dictionary-revision';
const DICTIONARY_SNAPSHOT_KEY = 'ranking:v2:dictionary-snapshot';
let cached = null;

export function invalidateCanonicalSkillDictionary() {
  cached = null;
}

export async function publishCanonicalSkillDictionaryChange(changedEntries = []) {
  cached = null;
  if (!isRedisReady()) return;
  const redis = getRedis();
  const previousRevision = String((await redis.get(DICTIONARY_REVISION_KEY)) || '0');
  const nextRevision = String(await redis.incr(DICTIONARY_REVISION_KEY));
  if (!changedEntries.length) {
    await redis.del(DICTIONARY_SNAPSHOT_KEY);
    return;
  }
  try {
    const raw = await redis.get(DICTIONARY_SNAPSHOT_KEY);
    const previous = raw ? JSON.parse(raw) : null;
    if (!previous || String(previous.revision) !== previousRevision || !Array.isArray(previous.entries)) {
      await redis.del(DICTIONARY_SNAPSHOT_KEY);
      return;
    }
    const byCanonical = new Map(previous.entries.map((entry) => [entry.nameCanonical, entry]));
    for (const entry of changedEntries) {
      const nameCanonical = String(entry?.nameCanonical || '').trim();
      if (!nameCanonical) continue;
      byCanonical.set(nameCanonical, {
        name: entry.name || nameCanonical,
        nameCanonical,
        skillId: Number(entry.skillId) || stableSkillId(nameCanonical),
      });
    }
    const entries = [...byCanonical.values()];
    await redis.set(DICTIONARY_SNAPSHOT_KEY, JSON.stringify({
      revision: nextRevision,
      version: dictionaryVersionFor(entries),
      entries,
    }));
  } catch {
    await redis.del(DICTIONARY_SNAPSHOT_KEY);
  }
}

async function currentRevision() {
  if (!isRedisReady()) return 'local';
  return String((await getRedis().get(DICTIONARY_REVISION_KEY)) || '0');
}

async function readDictionaryDocuments() {
  if (!skillDictionaryCollection) return [];
  const options = { projection: { name: 1, nameCanonical: 1, skillId: 1 } };
  const cursor = typeof skillDictionaryCollection.findPaged === 'function'
    ? skillDictionaryCollection.findPaged({}, { ...options, pageSize: 1_000 })
    : skillDictionaryCollection.find({}, options);
  const docs = [];
  for await (const doc of cursor) docs.push(doc);
  return docs;
}

function buildSnapshot(docs, revision, knownVersion = null) {
	const byName = new Map();
	const byId = new Map();
	const byToken = new Map();
	const entries = [];
  for (const doc of docs) {
    const canonical = String(doc.nameCanonical || '').trim();
    if (!canonical) continue;
    const id = Number(doc.skillId) || stableSkillId(canonical);
    const collision = byId.get(id);
    if (collision && collision !== canonical) {
      throw new Error(`Canonical skill id collision: ${collision} and ${canonical} -> ${id}`);
    }
    byName.set(canonical, id);
    byId.set(id, canonical);
		const entry = {
			name: doc.name || canonical,
			nameCanonical: canonical,
			skillId: id,
		};
		entries.push(entry);
		for (const token of skillTokens(entry.name)) {
			if (!byToken.has(token)) byToken.set(token, []);
			byToken.get(token).push(entry);
		}
	}
	return {
		byName,
		byId,
		byToken,
    version: knownVersion || dictionaryVersionFor(entries),
    entries,
    revision,
    expiresAt: Date.now() + SNAPSHOT_TTL_MS,
  };
}

async function readRedisSnapshot(revision) {
  if (!isRedisReady()) return null;
  try {
    const raw = await getRedis().get(DICTIONARY_SNAPSHOT_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (String(stored?.revision) !== String(revision) || !Array.isArray(stored?.entries)) return null;
    const snapshot = buildSnapshot(stored.entries, revision, stored.version || null);
    if (!stored.version) {
      await getRedis().set(DICTIONARY_SNAPSHOT_KEY, JSON.stringify({
        revision,
        version: snapshot.version,
        entries: snapshot.entries,
      }));
    }
    return snapshot;
  } catch {
    return null;
  }
}

export async function loadCanonicalSkillDictionary({ force = false } = {}) {
  let revision = await currentRevision();
  if (!force && cached?.expiresAt > Date.now() && cached.revision === revision) return cached;
  const redisSnapshot = await readRedisSnapshot(revision);
  if (redisSnapshot) {
    cached = redisSnapshot;
    return cached;
  }
  let docs = [];
  let stable = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = revision;
    docs = await readDictionaryDocuments();
    revision = await currentRevision();
    if (before === revision) {
      stable = true;
      break;
    }
  }
  if (!stable) throw new Error('Canonical skill dictionary changed repeatedly while loading');
  cached = buildSnapshot(docs, revision);
  if (isRedisReady()) {
    await getRedis().set(DICTIONARY_SNAPSHOT_KEY, JSON.stringify({
      revision,
      version: cached.version,
      entries: cached.entries,
    }));
  }
  return cached;
}

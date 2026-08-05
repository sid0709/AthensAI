import { skillDictionaryCollection } from '../../db/dataStore.js';
import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import { dictionaryVersionFor, stableSkillId } from './canonicalSkillIdentity.js';
import { skillTokens } from '@nextoffer/shared/skill-tokens';

const SNAPSHOT_TTL_MS = 5 * 60_000;
const METADATA_ID = 'skill_dictionary';
let cached = null;

export function invalidateCanonicalSkillDictionary() {
  cached = null;
}

export async function publishCanonicalSkillDictionaryChange(changedEntries = []) {
  cached = null;
  const db = getFirestoreDb();
  const ref = db.collection('system_metadata').doc(METADATA_ID);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    transaction.set(ref, {
      revision: Math.max(0, Number(snapshot.data()?.revision || 0)) + 1,
      updatedAt: new Date(),
      changedCount: changedEntries.length,
    }, { merge: true });
  });
}

async function currentRevision() {
  const snapshot = await getFirestoreDb().collection('system_metadata').doc(METADATA_ID).get();
  return String(snapshot.data()?.revision || 0);
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

export async function loadCanonicalSkillDictionary({ force = false } = {}) {
  let revision = await currentRevision();
  if (!force && cached?.expiresAt > Date.now() && cached.revision === revision) return cached;
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
  return cached;
}

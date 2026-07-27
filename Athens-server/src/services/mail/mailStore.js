import {
	mailMessagesCollection,
	mailSyncStateCollection,
	mailUserLabelsCollection,
} from '../../db/mongo.js';
import { createHash } from 'node:crypto';
import { ALL_MAIL_PATH, extractCustomLabels } from './folderMapper.js';
import { deleteStoredObject, putBinaryObject, readStoredObject, storageSlug } from '../firebase/objectStore.js';
import { getRedis, isRedisReady } from '../../db/redis.js';

const MAIL_INLINE_BODY_BYTES = 350 * 1024;
const MAIL_LABEL_MARKER_VERSION = 1;
const labelMarkerBackfills = new Map();

function labelDefinitionsCacheKey(applierName) {
	return `mail:v2:label-definitions:${String(applierName).trim().toLowerCase()}`;
}

function withCustomLabelMarker(patch) {
	if (!Array.isArray(patch?.labels)) return patch;
	return { ...patch, hasCustomLabels: patch.labels.length > 0 };
}

function mailBodyPath(applierName, uid, mailbox) {
	const key = createHash('sha256').update(`${mailbox}\0${Number(uid)}`).digest('hex').slice(0, 32);
	return `mail-bodies/${storageSlug(applierName)}/${key}/body.json`;
}

async function externalizeMailBody(applierName, uid, mailbox, patch) {
	const body = {
		bodyText: typeof patch.bodyText === 'string' ? patch.bodyText : '',
		bodyHtml: typeof patch.bodyHtml === 'string' ? patch.bodyHtml : null,
	};
	const bytes = Buffer.from(JSON.stringify(body), 'utf8');
	if (bytes.length <= MAIL_INLINE_BODY_BYTES) return { ...patch, bodyObject: null, bodyExternalized: false };

	const stored = await putBinaryObject({
		buffer: bytes,
		objectPath: mailBodyPath(applierName, uid, mailbox),
		mimeType: 'application/json',
		metadata: { applierName, uid: Number(uid), mailbox, kind: 'mail-body' },
	});
	if (stored.storage !== 'gcs') return patch;
	return {
		...patch,
		bodyText: body.bodyText.slice(0, 32 * 1024),
		bodyHtml: null,
		bodyObject: stored.file,
		bodyExternalized: stored.storage === 'gcs',
	};
}

async function hydrateMailBody(doc) {
	if (!doc) return doc;
	if (doc.bodyObject?.storagePath) {
		const bytes = await readStoredObject(doc);
		if (!bytes) return doc;
		const body = JSON.parse(bytes.toString('utf8'));
		return { ...doc, ...body };
	}
	const hydrated = { ...doc };
	for (const field of ['bodyText', 'bodyHtml']) {
		if (!doc[field]?.object?.storagePath) continue;
		const bytes = await readStoredObject({ object: doc[field].object });
		hydrated[field] = bytes?.toString(doc[field].encoding === 'base64' ? 'base64' : 'utf8') ?? null;
	}
	return hydrated;
}

function getInitialSyncSize() {
	return Number.parseInt(process.env.MAIL_INITIAL_SYNC_SIZE || '250', 10) || 250;
}

function getOlderBatchSize() {
	return Number.parseInt(process.env.MAIL_OLDER_BATCH_SIZE || '50', 10) || 50;
}

function getSyncMinIntervalMs() {
	return Number.parseInt(process.env.MAIL_SYNC_MIN_INTERVAL_MS || '45000', 10) || 45000;
}

export { getInitialSyncSize, getOlderBatchSize, getSyncMinIntervalMs };

export async function getSyncState(applierName) {
	if (!mailSyncStateCollection) return null;
	const doc = await mailSyncStateCollection.findOne({ applierName });
	return (
		doc || {
			applierName,
			highestUid: 0,
			oldestCachedUid: 0,
			initialSyncComplete: false,
			lastImapSyncAt: null,
			syncInProgress: false,
			lastError: null,
		}
	);
}

export async function upsertSyncState(applierName, patch) {
	if (!mailSyncStateCollection) return;
	await mailSyncStateCollection.updateOne(
		{ applierName },
		{
			$set: { ...patch, updatedAt: new Date() },
			$setOnInsert: { applierName },
		},
		{ upsert: true },
	);
}

export async function acquireSyncLock(applierName) {
	if (!mailSyncStateCollection) return false;
	const result = await mailSyncStateCollection.findOneAndUpdate(
		{
			applierName,
			$or: [{ syncInProgress: { $exists: false } }, { syncInProgress: { $ne: true } }],
		},
		{
			$set: { syncInProgress: true, updatedAt: new Date() },
			$setOnInsert: {
				applierName,
				highestUid: 0,
				oldestCachedUid: 0,
				initialSyncComplete: false,
			},
		},
		{ returnDocument: 'after', upsert: true },
	);
	return Boolean(result && result.syncInProgress);
}

export async function releaseSyncLock(applierName, patch = {}) {
	await upsertSyncState(applierName, { syncInProgress: false, ...patch });
}

export async function canSync(applierName, force = false) {
	if (force) return true;
	const state = await getSyncState(applierName);
	if (state.syncInProgress) return false;
	if (!state.lastImapSyncAt) return true;
	const elapsed = Date.now() - new Date(state.lastImapSyncAt).getTime();
	return elapsed >= getSyncMinIntervalMs();
}

export async function upsertMessages(messages) {
	if (!mailMessagesCollection || !messages.length) return { upserted: 0 };
	const prepared = await Promise.all(messages.map(async (msg) => {
		if (!msg.hasBody) return msg;
		return { ...msg, ...(await externalizeMailBody(msg.applierName, msg.uid, msg.mailbox || ALL_MAIL_PATH, msg)) };
	}));
	const ops = prepared.map((msg) => {
		const mailbox = msg.mailbox || ALL_MAIL_PATH;
		const setFields = withCustomLabelMarker({ ...msg, mailbox, syncedAt: new Date() });
		// Preserve cached bodies when refreshing envelopes/flags only
		if (!msg.hasBody) {
			delete setFields.hasBody;
			delete setFields.bodyText;
			delete setFields.bodyHtml;
		}
		return {
			updateOne: {
				filter: { applierName: msg.applierName, mailbox, uid: msg.uid },
				update: {
					$set: setFields,
					$setOnInsert: { hasBody: false, bodyText: '', bodyHtml: null },
				},
				upsert: true,
			},
		};
	});
	const result = await mailMessagesCollection.bulkWrite(ops, { ordered: false });
	return { upserted: result.upsertedCount + result.modifiedCount };
}

function messageFilter(applierName, uid, mailbox) {
	const filter = { applierName, uid: Number(uid) };
	if (mailbox) filter.mailbox = mailbox;
	return filter;
}

export async function updateMessageFlags(applierName, uid, patch, mailbox = ALL_MAIL_PATH) {
	if (!mailMessagesCollection) return null;
	const result = await mailMessagesCollection.findOneAndUpdate(
		messageFilter(applierName, uid, mailbox),
		{ $set: { ...withCustomLabelMarker(patch), syncedAt: new Date() } },
		{ returnDocument: 'after' },
	);
	return result;
}

/** Persist a Gmail flag/label refresh with one unordered database write. */
export async function bulkUpdateMessageFlags(applierName, updates) {
	if (!mailMessagesCollection || !Array.isArray(updates) || updates.length === 0) return { updated: 0 };
	const syncedAt = new Date();
	const ops = updates
		.filter((item) => Number.isFinite(Number(item?.uid)))
		.map((item) => {
			const { _id, uid, mailbox = ALL_MAIL_PATH, ...patch } = item;
			return {
				updateOne: {
					filter: _id ? { _id } : messageFilter(applierName, uid, mailbox),
					update: { $set: { ...withCustomLabelMarker(patch), syncedAt } },
				},
			};
		});
	if (!ops.length) return { updated: 0 };

	// Firestore can patch known document IDs in one commit. Falling back to the
	// Mongo-shaped bulk writer here would run a read transaction for every
	// message and can keep the interactive AI-label request open for minutes.
	const exactIdOps = ops.filter((operation) => operation.updateOne.filter._id);
	const lookupOps = ops.filter((operation) => !operation.updateOne.filter._id);
	let updated = 0;
	if (exactIdOps.length && typeof mailMessagesCollection.atomicBulkPatch === 'function') {
		const result = await mailMessagesCollection.atomicBulkPatch(exactIdOps);
		updated += result.modifiedCount || 0;
	} else {
		lookupOps.push(...exactIdOps);
	}
	if (lookupOps.length) {
		const result = await mailMessagesCollection.bulkWrite(lookupOps, { ordered: false });
		updated += result.modifiedCount || 0;
	}
	return { updated };
}

export async function updateMessageBody(applierName, uid, bodyPatch, mailbox = ALL_MAIL_PATH) {
	if (!mailMessagesCollection) return null;
	const storedPatch = await externalizeMailBody(applierName, uid, mailbox, bodyPatch);
	const updated = await mailMessagesCollection.findOneAndUpdate(
		messageFilter(applierName, uid, mailbox),
		{
			$set: {
				...storedPatch,
				mailbox,
				hasBody: true,
				syncedAt: new Date(),
			},
		},
		{ returnDocument: 'after' },
	);
	return hydrateMailBody(updated);
}

/** Cache plain text for AI/search without claiming a full HTML body is loaded. */
export async function updateMessagePlainText(applierName, uid, { bodyText, preview }, mailbox = ALL_MAIL_PATH) {
	if (!mailMessagesCollection) return null;
	const $set = {
		mailbox,
		syncedAt: new Date(),
	};
	if (typeof bodyText === 'string') $set.bodyText = bodyText;
	if (typeof preview === 'string') $set.preview = preview;
	if (Buffer.byteLength(String(bodyText || ''), 'utf8') > MAIL_INLINE_BODY_BYTES) {
		Object.assign($set, await externalizeMailBody(applierName, uid, mailbox, { bodyText, bodyHtml: null }));
	}
	return mailMessagesCollection.findOneAndUpdate(
		messageFilter(applierName, uid, mailbox),
		{ $set },
		{ returnDocument: 'after' },
	);
}

export async function clearMessageBody(applierName, uid, mailbox = ALL_MAIL_PATH) {
	if (!mailMessagesCollection) return null;
	const existing = await mailMessagesCollection.findOne(messageFilter(applierName, uid, mailbox));
	if (existing?.bodyObject) await deleteStoredObject(existing);
	return mailMessagesCollection.findOneAndUpdate(
		messageFilter(applierName, uid, mailbox),
		{
			$set: {
				hasBody: false,
				bodyText: '',
				bodyHtml: null,
				bodyObject: null,
				bodyExternalized: false,
				syncedAt: new Date(),
			},
		},
		{ returnDocument: 'after' },
	);
}

export async function getMessage(applierName, uid, mailbox) {
	if (!mailMessagesCollection) return null;
	if (mailbox) {
		let doc = await mailMessagesCollection.findOne(messageFilter(applierName, uid, mailbox));
		if (!doc && String(process.env.DATABASE_BACKEND || '').trim().toLowerCase() !== 'firestore') {
			// Legacy rows keyed only by uid (pre-mailbox migration)
			doc = await mailMessagesCollection.findOne({
				applierName,
				uid: Number(uid),
				$or: [{ mailbox: { $exists: false } }, { mailbox: null }, { mailbox: '' }],
			});
		}
		return hydrateMailBody(doc);
	}
	// Legacy fallback: prefer INBOX over All Mail when ambiguous
	const docs = await mailMessagesCollection
		.find({ applierName, uid: Number(uid) })
		.sort({ syncedAt: -1 })
		.limit(5)
		.toArray();
	if (docs.length === 1) return docs[0];
	const inbox = docs.find((d) => d.mailbox === 'INBOX');
	return hydrateMailBody(inbox || docs[0] || null);
}

export async function listMessages(
	applierName,
	{ folder, label, search, unlabeled, page = 1, pageSize = 25, limit, beforeDate, mailbox } = {},
) {
	if (!mailMessagesCollection) return [];

	const filter = buildMessageFilter(applierName, { folder, label, search, unlabeled, beforeDate, mailbox });
	const size = Math.min(Math.max(limit ?? pageSize, 1), 100);
	const skip = limit ? 0 : (Math.max(page, 1) - 1) * size;

	return mailMessagesCollection
		.find(filter)
		.project({
			uid: 1,
			mailbox: 1,
			from: 1,
			subject: 1,
			preview: 1,
			date: 1,
			flags: 1,
			gmailLabels: 1,
			labels: 1,
			hasCustomLabels: 1,
			folder: 1,
			hasBody: 1,
		})
		.sort({ date: -1 })
		.skip(skip)
		.limit(size)
		.toArray();
}

export async function countMessages(applierName, { folder, label, search, unlabeled, beforeDate, mailbox } = {}) {
	if (!mailMessagesCollection) return 0;
	const filter = buildMessageFilter(applierName, { folder, label, search, unlabeled, beforeDate, mailbox });
	if (unlabeled) {
		// The Firestore compatibility adapter cannot aggregate Mongo's `$size`.
		// A projected native query avoids downloading email bodies while an index
		// is being created and remains fast after the marker index is available.
		return (await mailMessagesCollection.find(filter).project({ _id: 1 }).toArray()).length;
	}
	return mailMessagesCollection.countDocuments(filter);
}

function buildMessageFilter(applierName, { folder, label, search, unlabeled, beforeDate, mailbox } = {}) {
	const filter = { applierName };
	if (mailbox) filter.mailbox = mailbox;
	if (folder) filter.folder = folder;
	if (unlabeled) {
		filter.hasCustomLabels = false;
	}
	if (label) {
		const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		filter.gmailLabels = { $regex: escaped, $options: 'i' };
	}
	if (beforeDate) filter.date = { $lt: new Date(beforeDate) };
	if (search?.trim()) {
		const q = search.trim();
		filter.$or = [
			{ subject: { $regex: q, $options: 'i' } },
			{ 'from.name': { $regex: q, $options: 'i' } },
			{ 'from.email': { $regex: q, $options: 'i' } },
			{ preview: { $regex: q, $options: 'i' } },
			{ bodyText: { $regex: q, $options: 'i' } },
		];
	}
	return filter;
}

export async function getCachedMessageCount(applierName, uids, mailbox = ALL_MAIL_PATH) {
	if (!mailMessagesCollection || !uids.length) return 0;
	return mailMessagesCollection.countDocuments({
		applierName,
		mailbox,
		uid: { $in: uids },
	});
}

/** Load cached body flags (and content) for a page of IMAP envelopes. */
export async function getMessagesByUids(applierName, uids, mailbox = ALL_MAIL_PATH) {
	if (!mailMessagesCollection || !uids.length) return [];
	const docs = await mailMessagesCollection
		.find({ applierName, mailbox, uid: { $in: uids } })
		.project({
			uid: 1,
			mailbox: 1,
			from: 1,
			subject: 1,
			date: 1,
			folder: 1,
			flags: 1,
			labels: 1,
			gmailLabels: 1,
			hasCustomLabels: 1,
			hasBody: 1,
			bodyHtml: 1,
			bodyText: 1,
			bodyObject: 1,
			preview: 1,
			aiSnippet: 1,
			aiSnippetCachedAt: 1,
			aiBodyText: 1,
			aiBodyCachedAt: 1,
			messageId: 1,
		})
		.toArray();
	return Promise.all(docs.map(hydrateMailBody));
}

/**
 * One-time, per-account migration for the indexed unlabeled-mail marker.
 * Existing cached messages predate `hasCustomLabels`; new syncs write it
 * automatically. A shared promise prevents duplicate scans on concurrent UI loads.
 */
export async function ensureCustomLabelMarkers(applierName) {
	if (!mailMessagesCollection || !mailSyncStateCollection) return { updated: 0 };
	const key = String(applierName || '').trim().toLowerCase();
	if (!key) return { updated: 0 };
	if (labelMarkerBackfills.has(key)) return labelMarkerBackfills.get(key);

	const promise = (async () => {
		const state = await getSyncState(applierName);
		if (Number(state?.customLabelMarkerVersion || 0) >= MAIL_LABEL_MARKER_VERSION) return { updated: 0 };

		const docs = await mailMessagesCollection
			.find({ applierName, hasCustomLabels: { $exists: false } })
			.project({ _id: 1, labels: 1, gmailLabels: 1 })
			.toArray();
		const operations = docs.map((doc) => ({
			updateOne: {
				filter: { _id: doc._id },
				update: {
					$set: {
						hasCustomLabels: Array.isArray(doc.labels)
							? doc.labels.length > 0
							: extractCustomLabels(doc.gmailLabels || []).length > 0,
						},
					},
				},
		}));

		if (operations.length) {
			if (typeof mailMessagesCollection.atomicBulkPatch === 'function') {
				await mailMessagesCollection.atomicBulkPatch(operations);
			} else {
				await mailMessagesCollection.bulkWrite(operations, { ordered: false });
			}
		}
		await upsertSyncState(applierName, { customLabelMarkerVersion: MAIL_LABEL_MARKER_VERSION });
		return { updated: operations.length };
	})().finally(() => labelMarkerBackfills.delete(key));

	labelMarkerBackfills.set(key, promise);
	return promise;
}

export function enrichMessagesFromCache(messages, cachedDocs) {
	if (!cachedDocs.length) return messages;
	const byUid = new Map(cachedDocs.map((d) => [d.uid, d]));
	return messages.map((msg) => {
		const cached = byUid.get(msg.uid);
		if (!cached?.hasBody) return msg;
		return {
			...msg,
			hasBody: true,
			bodyHtml: cached.bodyHtml ?? msg.bodyHtml,
			bodyText: cached.bodyText || msg.bodyText,
			preview: cached.preview || msg.preview,
			messageId: cached.messageId || msg.messageId,
		};
	});
}

export async function getRecentUidsForFlagRefresh(applierName, days = 7) {
	if (!mailMessagesCollection) return [];
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const docs = await mailMessagesCollection
		.find({ applierName, date: { $gte: since } })
		.project({ uid: 1 })
		.toArray();
	return docs.map((d) => d.uid);
}

export async function getUserLabels(_applierName) {
	// Deprecated — labels come from Gmail via IMAP in mailController
	return [];
}

export async function saveUserLabels(_applierName, labels) {
	return labels;
}

/** @param {unknown} raw */
export function normalizeLabelDefinitions(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out = {};
	for (const [key, value] of Object.entries(raw)) {
		const k = String(key || '').trim();
		if (!k) continue;
		out[k] = String(value ?? '').trim().slice(0, 2000);
	}
	return out;
}

/**
 * Load AI label definitions for an applier from mail_user_labels.
 * Optionally migrates once from account_info.autoBidProfile.mailLabelDefinitions.
 * @param {string} applierName
 * @param {Record<string, string>|null|undefined} [legacyDefinitions]
 */
export async function getUserLabelDefinitions(applierName, legacyDefinitions = null) {
	if (!mailUserLabelsCollection) return normalizeLabelDefinitions(legacyDefinitions);
	if (isRedisReady()) {
		const cached = await getRedis().get(labelDefinitionsCacheKey(applierName)).catch(() => null);
		if (cached) {
			try {
				return normalizeLabelDefinitions(JSON.parse(cached));
			} catch {
				await getRedis().del(labelDefinitionsCacheKey(applierName)).catch(() => undefined);
			}
		}
	}

	const doc = await mailUserLabelsCollection.findOne({ applierName });
	if (doc?.definitions && typeof doc.definitions === 'object') {
		const definitions = normalizeLabelDefinitions(doc.definitions);
		if (isRedisReady()) {
			await getRedis().setEx(labelDefinitionsCacheKey(applierName), 600, JSON.stringify(definitions)).catch(() => undefined);
		}
		return definitions;
	}

	const fromLegacy = normalizeLabelDefinitions(legacyDefinitions);
	if (Object.keys(fromLegacy).length) {
		await saveUserLabelDefinitions(applierName, fromLegacy);
		return fromLegacy;
	}
	return {};
}

/**
 * Persist AI label definitions per applier in mail_user_labels.
 * @param {string} applierName
 * @param {Record<string, string>} definitions
 */
export async function saveUserLabelDefinitions(applierName, definitions) {
	if (!mailUserLabelsCollection) {
		throw new Error('Database not ready');
	}
	const normalized = normalizeLabelDefinitions(definitions);
	const updatedAt = new Date().toISOString();
	await mailUserLabelsCollection.updateOne(
		{ applierName },
		{ $set: { applierName, definitions: normalized, updatedAt } },
		{ upsert: true },
	);
	if (isRedisReady()) {
		await getRedis().setEx(labelDefinitionsCacheKey(applierName), 600, JSON.stringify(normalized)).catch(() => undefined);
	}
	return normalized;
}

export function messageToThread(doc, { includeBody = true } = {}) {
	const date = doc.date instanceof Date
		? doc.date
		: doc.date?.toDate instanceof Function
			? doc.date.toDate()
			: new Date(doc.date || 0);
	const safeDate = Number.isNaN(date.getTime()) ? new Date(0) : date;
	const customLabels = doc.gmailLabels?.length
		? extractCustomLabels(doc.gmailLabels)
		: (doc.labels || []).filter((l) => l !== 'starred' && l !== 'Starred');

	return {
		id: String(doc.uid),
		uid: doc.uid,
		mailbox: doc.mailbox || ALL_MAIL_PATH,
		from: doc.from?.name
			? doc.from.name
			: doc.from?.email || 'Unknown',
		fromEmail: doc.from?.email || '',
		subj: doc.subject || '(No subject)',
		prev: doc.preview || '',
		body: includeBody ? doc.bodyText || doc.preview || '' : doc.preview || '',
		bodyHtml: includeBody ? doc.bodyHtml || null : null,
		time: formatMailTime(safeDate),
		date: safeDate.toISOString(),
		unread: !doc.flags?.seen,
		starred: Boolean(doc.flags?.flagged),
		tag: customLabels[0] || '',
		folder: doc.folder || 'inbox',
		labels: customLabels,
		gmailLabels: doc.gmailLabels || [],
		hasBody: Boolean(doc.hasBody),
	};
}

/** Today → "3:17 PM"; previous days → "Jun 19" (single line) */
function formatMailTime(date) {
	const now = new Date();
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();

	if (isToday) {
		return date.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
		});
	}
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${months[date.getMonth()]} ${date.getDate()}`;
}

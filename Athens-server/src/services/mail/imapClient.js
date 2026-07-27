import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { withPooledClient } from './imapPool.js';
import { mapPool } from '../../utils/concurrency.js';
import {
	ALL_MAIL_PATH,
	FOLDER_MAILBOX,
	envelopeFrom,
	envelopeToArray,
	extractCustomLabels,
	folderToMailbox,
	gmailLabelsToArray,
	mapGmailLabelsToFolder,
	messageToDoc,
	toImapLabelToken,
	displayLabelName,
	isSystemLabel,
} from './folderMapper.js';

const UNLABELED_SCAN_BATCH_SIZE = Math.max(
	100,
	Number(process.env.MAIL_UNLABELED_SCAN_BATCH_SIZE || 2_000),
);
const UNLABELED_SCAN_CONCURRENCY = Math.max(
	1,
	Number(process.env.MAIL_UNLABELED_SCAN_CONCURRENCY || 8),
);

function stripHtml(html) {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Prefer text/plain; fall back to text/html for plain-text extraction. */
export function findTextBodyPart(structure, preferHtml = false) {
	if (!structure) return null;
	const want = preferHtml ? 'text/html' : 'text/plain';
	const type = String(structure.type || '').toLowerCase();
	if (type === want) {
		return { ...structure, part: structure.part || '1' };
	}
	for (const child of structure.childNodes || []) {
		const found = findTextBodyPart(child, preferHtml);
		if (found) return found;
	}
	return null;
}

function decodeBodyPartBuffer(buf, structureNode) {
	if (!buf) return '';
	const charset = String(structureNode?.parameters?.charset || 'utf-8').trim() || 'utf-8';
	try {
		return new TextDecoder(charset).decode(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
	} catch {
		return Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf);
	}
}

/**
 * Build the smallest set of IMAP body-part fetches for a group of messages.
 * Most Gmail messages use the same text part (usually `1` or `1.1`), so this
 * turns two commands per message into one structure command plus a few grouped
 * partial-body commands.
 */
export function groupMessageTextParts(messages) {
	const groups = new Map();
	const unresolved = [];
	for (const message of messages || []) {
		const plainPart = findTextBodyPart(message?.bodyStructure, false);
		const htmlPart = plainPart ? null : findTextBodyPart(message?.bodyStructure, true);
		const partNode = plainPart || htmlPart;
		const partId = String(partNode?.part || '').trim();
		if (!partId || !Number.isFinite(Number(message?.uid))) {
			unresolved.push(Number(message?.uid));
			continue;
		}
		const isHtml = Boolean(htmlPart && !plainPart);
		const key = `${partId}\0${isHtml ? 'html' : 'plain'}`;
		if (!groups.has(key)) groups.set(key, { partId, isHtml, messages: [] });
		groups.get(key).messages.push({ uid: Number(message.uid), partNode });
	}
	return { groups: [...groups.values()], unresolved: unresolved.filter(Number.isFinite) };
}

function extractHtmlBody(parsed) {
	if (parsed.html?.trim()) return parsed.html.trim();
	if (typeof parsed.textAsHtml === 'string' && parsed.textAsHtml.trim()) {
		return parsed.textAsHtml.trim();
	}
	if (Array.isArray(parsed.alternatives)) {
		const htmlAlt = parsed.alternatives.find((part) =>
			String(part.contentType ?? '').toLowerCase().includes('text/html'),
		);
		if (htmlAlt?.content) {
			const content = htmlAlt.content;
			return typeof content === 'string' ? content.trim() : content.toString().trim();
		}
	}
	return null;
}

async function createClient(email, password) {
	const client = new ImapFlow({
		host: 'imap.gmail.com',
		port: 993,
		secure: true,
		auth: { user: email, pass: password },
		logger: false,
	});
	await client.connect();
	return client;
}

export async function verifyImapCredentials(email, password) {
	const normalizedEmail = String(email ?? '').trim();
	const normalizedPassword = String(password ?? '').replace(/\s/g, '');
	if (!normalizedEmail || !normalizedPassword) {
		return { ok: false, error: 'Email and Gmail app password are required.' };
	}
	let client;
	try {
		client = await createClient(normalizedEmail, normalizedPassword);
		await client.logout();
		return { ok: true, email: normalizedEmail };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'IMAP connection failed';
		return { ok: false, error: message, email: normalizedEmail };
	}
}

function inlineCidImages(html, attachments) {
	if (!html || !attachments?.length) return html;
	let result = html;
	for (const att of attachments) {
		const cid = att.cid || att.contentId;
		if (!cid || !att.content) continue;
		const cleanCid = String(cid).replace(/^<|>$/g, '');
		const mime = att.contentType || 'image/png';
		const content = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
		const dataUri = `data:${mime};base64,${content.toString('base64')}`;
		const escaped = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		result = result.replace(new RegExp(`cid:${escaped}`, 'gi'), dataUri);
	}
	return result;
}

async function withMailboxPath(email, password, mailboxPath, fn) {
	return withPooledClient(email, password, mailboxPath, fn);
}

async function withMailbox(email, password, fn) {
	return withPooledClient(email, password, ALL_MAIL_PATH, fn);
}

/**
 * Fetch the most recent `count` messages by sequence number (envelope only).
 */
export async function fetchRecentEnvelopes(email, password, count, applierName) {
	return withMailbox(email, password, async (client) => {
		const total = client.mailbox.exists ?? 0;
		if (total === 0) return { messages: [], highestUid: 0, lowestUid: 0 };

		const start = Math.max(1, total - count + 1);
		const range = `${start}:${total}`;
		const messages = [];

		for await (const message of client.fetch(range, {
			envelope: true,
			flags: true,
			uid: true,
			labels: true,
		})) {
			messages.push(messageToDoc(message, applierName, ALL_MAIL_PATH));
		}

		messages.reverse();
		const uids = messages.map((m) => m.uid);
		return {
			messages,
			highestUid: uids.length ? Math.max(...uids) : 0,
			lowestUid: uids.length ? Math.min(...uids) : 0,
		};
	});
}

export function filterExactUnlabeledDocs(docs) {
	return (docs || []).filter((doc) => extractCustomLabels(doc?.gmailLabels).length === 0);
}

async function fetchInboxEnvelopeBatch(email, password, uids, applierName) {
	return withMailboxPath(email, password, 'INBOX', async (client) => {
		const messages = [];
		for await (const message of client.fetch(uids, {
			envelope: true,
			flags: true,
			uid: true,
			labels: true,
		})) {
			messages.push(messageToDoc(message, applierName, 'INBOX'));
		}
		return messages;
	});
}

/**
 * Fetch an exact page of messages with no user-created Gmail labels.
 *
 * Gmail's `has:nouserlabels` raw search is conversation-aware and can return a
 * labeled message when another message in the same thread is unlabeled. Search
 * the INBOX UID set, fetch only envelope/flag metadata in parallel batches, and
 * make the final decision from each message's X-GM-LABELS value instead.
 */
export async function fetchUnlabeledInboxEnvelopes(
	email,
	password,
	{ page = 1, pageSize = 50, applierName } = {},
) {
	const matches = await withMailboxPath(
		email,
		password,
		'INBOX',
		(client) => client.search({ all: true }, { uid: true }),
	);
	const newestUids = [...(matches || [])]
		.map(Number)
		.filter(Number.isFinite)
		.sort((a, b) => b - a);
	const batches = [];
	for (let offset = 0; offset < newestUids.length; offset += UNLABELED_SCAN_BATCH_SIZE) {
		batches.push(newestUids.slice(offset, offset + UNLABELED_SCAN_BATCH_SIZE));
	}
	const groups = await mapPool(
		batches,
		Math.min(UNLABELED_SCAN_CONCURRENCY, Math.max(1, batches.length)),
		(uids) => fetchInboxEnvelopeBatch(email, password, uids, applierName),
	);
	const allMessages = filterExactUnlabeledDocs(groups.flat())
		.sort((left, right) => right.uid - left.uid);
	const start = (Math.max(1, page) - 1) * pageSize;
	return {
		messages: allMessages.slice(start, start + pageSize),
		allMessages,
		total: allMessages.length,
		hasMore: allMessages.length > start + pageSize,
	};
}

/**
 * Fetch the most recent `count` INBOX messages WITH fully-parsed bodies, straight
 * from Gmail — no Mongo cache. Used for time-critical reads (e.g. an emailed OTP
 * code) where the synced cache may lag or hold a not-yet-materialized body for a
 * just-arrived message. Returns newest-first.
 */
export async function fetchRecentInboxWithBodies(email, password, count = 10, mailboxPath = 'INBOX') {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const total = client.mailbox.exists ?? 0;
		if (total === 0) return [];

		const start = Math.max(1, total - count + 1);
		const range = `${start}:${total}`;
		const out = [];

		for await (const message of client.fetch(range, { source: true, uid: true, flags: true, envelope: true })) {
			if (!message?.source) continue;
			try {
				const parsed = await simpleParser(message.source);
				const from = parsed.from?.value?.[0];
				const textBody = parsed.text?.trim() || stripHtml(parsed.html ?? '');
				out.push({
					uid: message.uid,
					from: from?.address || '',
					fromName: from?.name || parsed.from?.text || '',
					subject: parsed.subject || '',
					date: parsed.date ?? message.envelope?.date ?? null,
					bodyText: textBody || '',
					bodyHtml: extractHtmlBody(parsed) || '',
				});
			} catch {
				/* skip unparseable message */
			}
		}

		// Sequence fetch returns ascending (oldest→newest); sort newest-first.
		out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
		return out.slice(0, count);
	});
}

/**
 * Fetch messages with UID less than `beforeUid` (older mail).
 */
export async function fetchOlderEnvelopes(email, password, beforeUid, batchSize, applierName) {
	return withMailbox(email, password, async (client) => {
		const searchResult = await client.search({ uid: `1:${beforeUid - 1}` }, { uid: true });
		if (!searchResult || searchResult.length === 0) {
			return { messages: [], hasMore: false, lowestUid: beforeUid };
		}

		const uids = searchResult.sort((a, b) => b - a).slice(0, batchSize);
		const messages = [];

		for await (const message of client.fetch(uids, {
			envelope: true,
			flags: true,
			uid: true,
			labels: true,
		})) {
			messages.push(messageToDoc(message, applierName, ALL_MAIL_PATH));
		}

		messages.sort((a, b) => b.uid - a.uid);
		const lowestUid = messages.length ? Math.min(...messages.map((m) => m.uid)) : beforeUid;
		return {
			messages,
			hasMore: searchResult.length > batchSize,
			lowestUid,
		};
	});
}

/**
 * Incremental sync: fetch UIDs above highestUid.
 */
export async function fetchNewEnvelopes(email, password, highestUid, applierName) {
	return withMailbox(email, password, async (client) => {
		const searchResult = await client.search({ uid: `${highestUid + 1}:*` }, { uid: true });
		if (!searchResult || searchResult.length === 0) {
			return { messages: [], highestUid };
		}

		const messages = [];
		for await (const message of client.fetch(searchResult, {
			envelope: true,
			flags: true,
			uid: true,
			labels: true,
		})) {
			messages.push(messageToDoc(message, applierName, ALL_MAIL_PATH));
		}

		messages.sort((a, b) => b.uid - a.uid);
		const newHighest = Math.max(highestUid, ...messages.map((m) => m.uid));
		return { messages, highestUid: newHighest };
	});
}

/**
 * Re-fetch flags/labels for given UIDs (recent messages).
 */
export async function fetchFlagsForUids(email, password, uids, applierName, mailboxPath = ALL_MAIL_PATH) {
	if (!uids.length) return [];
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const updates = [];
		for await (const message of client.fetch(uids, {
			flags: true,
			uid: true,
			labels: true,
			envelope: true,
		})) {
			const seen = message.flags?.has('\\Seen') ?? false;
			const flagged = message.flags?.has('\\Flagged') ?? false;
			const gmailLabels = gmailLabelsToArray(message.labels);
			const folder = mapGmailLabelsToFolder(message.labels);
			const customLabels = extractCustomLabels(gmailLabels);
			updates.push({
				applierName,
				mailbox: mailboxPath,
				uid: message.uid,
				flags: { seen, flagged },
				gmailLabels,
				folder,
				labels: customLabels,
				syncedAt: new Date(),
			});
		}
		return updates;
	});
}

export async function fetchEnvelopeForUid(email, password, uid, applierName, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const message = await client.fetchOne(
			String(uid),
			{ envelope: true, flags: true, uid: true, labels: true },
			{ uid: true },
		);
		if (!message) return null;
		return messageToDoc(message, applierName, mailboxPath);
	});
}

export async function fetchMessageBody(email, password, uid, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const message = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
		if (!message?.source) {
			throw new Error('Message not found');
		}

		const parsed = await simpleParser(message.source);
		const from = parsed.from?.value?.[0];
		let htmlBody = extractHtmlBody(parsed);
		if (htmlBody && parsed.attachments?.length) {
			htmlBody = inlineCidImages(htmlBody, parsed.attachments);
		}
		const textBody = parsed.text?.trim() || stripHtml(parsed.html ?? '');
		const previewSource = textBody || stripHtml(parsed.html ?? '') || parsed.subject || '';

		const seen = message.flags?.has('\\Seen') ?? false;
		const flagged = message.flags?.has('\\Flagged') ?? false;

		return {
			uid,
			messageId: parsed.messageId || null,
			from: {
				name: from?.name || from?.address || parsed.from?.text || 'Unknown',
				email: from?.address || '',
			},
			to: envelopeToArray(parsed.to?.value),
			cc: envelopeToArray(parsed.cc?.value),
			subject: parsed.subject || '(No subject)',
			preview: previewSource.slice(0, 120).replace(/\s+/g, ' '),
			bodyText: textBody || '(No text content)',
			bodyHtml: htmlBody,
			date: parsed.date ?? new Date(),
			flags: { seen, flagged },
			hasBody: true,
		};
	});
}

/**
 * Fetch plain text only (text/plain part, else stripped text/html).
 * Avoids downloading/parsing full MIME HTML + CID inlining used by fetchMessageBody.
 */
export async function fetchMessagePlainText(email, password, uid, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const meta = await client.fetchOne(
			String(uid),
			{ bodyStructure: true, uid: true },
			{ uid: true },
		);
		if (!meta) {
			throw new Error('Message not found');
		}

		const plainPart = findTextBodyPart(meta.bodyStructure, false);
		const htmlPart = plainPart ? null : findTextBodyPart(meta.bodyStructure, true);
		const partNode = plainPart || htmlPart;
		const partId = partNode?.part;

		if (partId) {
			const withParts = await client.fetchOne(
				String(uid),
				{ bodyParts: [partId], uid: true },
				{ uid: true },
			);
			const raw = withParts?.bodyParts?.get(partId);
			let text = decodeBodyPartBuffer(raw, partNode).trim();
			if (htmlPart && !plainPart) {
				text = stripHtml(text);
			}
			const bodyText = text || '(No text content)';
			return {
				uid,
				bodyText,
				preview: bodyText.slice(0, 120).replace(/\s+/g, ' '),
			};
		}

		// Rare: no discrete text part — fall back to source parse, text only (no HTML/CID).
		const message = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
		if (!message?.source) {
			throw new Error('Message not found');
		}
		const parsed = await simpleParser(message.source);
		const textBody = parsed.text?.trim() || stripHtml(parsed.html ?? '');
		const bodyText = textBody || '(No text content)';
		return {
			uid,
			bodyText,
			preview: bodyText.slice(0, 120).replace(/\s+/g, ' '),
		};
	});
}

/**
 * Fetch bounded text excerpts for many UIDs using grouped partial-body IMAP
 * commands. The result never downloads attachments or the complete MIME source.
 */
export async function fetchMessageTextSnippets(
	email,
	password,
	uids,
	mailboxPath = ALL_MAIL_PATH,
	{ maxBytes = 2_048, maxChars = 1_000 } = {},
) {
	const uniqueUids = [...new Set((uids || []).map(Number).filter(Number.isFinite))];
	if (!uniqueUids.length) return [];
	const byteLimit = Math.max(256, Number(maxBytes) || 2_048);
	const charLimit = Math.max(120, Number(maxChars) || 1_000);

	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const structures = [];
		for await (const message of client.fetch(
			uniqueUids,
			{ bodyStructure: true, uid: true },
			{ uid: true },
		)) {
			structures.push(message);
		}

		const { groups, unresolved } = groupMessageTextParts(structures);
		const resultMap = new Map(
			unresolved.map((uid) => [uid, { uid, error: 'No text body part found' }]),
		);

		for (const group of groups) {
			const nodeByUid = new Map(group.messages.map((message) => [message.uid, message.partNode]));
			const groupUids = group.messages.map((message) => message.uid);
			for await (const message of client.fetch(
				groupUids,
				{
					bodyParts: [{ key: group.partId, start: 0, maxLength: byteLimit }],
					uid: true,
				},
				{ uid: true },
			)) {
				const raw = message?.bodyParts?.get(group.partId)
					|| (message?.bodyParts?.size ? message.bodyParts.values().next().value : null);
				let text = decodeBodyPartBuffer(raw, nodeByUid.get(Number(message.uid))).trim();
				if (group.isHtml) text = stripHtml(text);
				text = text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, charLimit);
				resultMap.set(Number(message.uid), text
					? { uid: Number(message.uid), bodyText: text, preview: text.slice(0, 240) }
					: { uid: Number(message.uid), error: 'Text body part was empty' });
			}
		}

		return uniqueUids.map((uid) => resultMap.get(uid) || { uid, error: 'Message not found' });
	});
}

export async function setMessageSeen(email, password, uid, seen, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		if (seen) {
			await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
		} else {
			await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
		}
	});
}

export async function setMessageFlagged(email, password, uid, flagged, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		if (flagged) {
			await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
		} else {
			await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true });
		}
	});
}

export async function archiveMessage(email, password, uid, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		// imapflow 1.x: Gmail labels via messageFlags* + useLabels (no messageLabels*)
		await client.messageFlagsRemove(String(uid), ['\\Inbox'], { uid: true, useLabels: true });
	});
}

export async function trashMessage(email, password, uid, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		await client.messageFlagsAdd(String(uid), ['\\Trash'], { uid: true, useLabels: true });
		await client.messageFlagsRemove(String(uid), ['\\Inbox'], { uid: true, useLabels: true });
	});
}

export async function moveToInbox(email, password, uid, mailboxPath = ALL_MAIL_PATH) {
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		await client.messageFlagsAdd(String(uid), ['\\Inbox'], { uid: true, useLabels: true });
		await client.messageFlagsRemove(String(uid), ['\\Trash'], { uid: true, useLabels: true });
	});
}

async function withClient(email, password, fn) {
	return withPooledClient(email, password, undefined, fn);
}

/**
 * List user-created Gmail labels from IMAP mailboxes.
 */
export async function fetchGmailLabelList(email, password) {
	return withClient(email, password, async (client) => {
		const mailboxes = await client.list();
		const labels = [];

		for (const box of mailboxes) {
			const path = displayLabelName(box.path);
			if (!path || path.startsWith('[Gmail]') || path.startsWith('[Google]')) continue;
			if (isSystemLabel(path)) continue;

			const parts = path.split('/');
			const name = parts[parts.length - 1];
			const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
			const parentId = parentPath ? parentPath.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined;

			labels.push({
				id: path.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
				name: path,
				shortName: name,
				path,
				parentId,
			});
		}

		labels.sort((a, b) => a.name.localeCompare(b.name));
		return labels;
	});
}

/**
 * Create a Gmail label (optionally nested under parent).
 */
export async function createGmailLabel(email, password, name, parentPath) {
	const trimmed = String(name ?? '').trim();
	if (!trimmed) throw new Error('Label name required');
	const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;

	return withClient(email, password, async (client) => {
		await client.mailboxCreate(fullPath);
		const parts = fullPath.split('/');
		return {
			id: fullPath.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
			name: fullPath,
			shortName: parts[parts.length - 1],
			path: fullPath,
			parentId: parentPath
				? parentPath.toLowerCase().replace(/[^a-z0-9]+/g, '-')
				: undefined,
		};
	});
}

/**
 * Delete a Gmail label (messages keep their content; label is removed from Gmail).
 */
export async function deleteGmailLabel(email, password, labelPath) {
	const path = String(labelPath ?? '').trim();
	if (!path) throw new Error('Label path required');

	return withClient(email, password, async (client) => {
		await client.mailboxDelete(path);
		return { deleted: path };
	});
}

export async function addLabelsToMessage(email, password, uid, labelNames, mailboxPath = ALL_MAIL_PATH) {
	return addLabelsToMessages(email, password, [uid], labelNames, mailboxPath);
}

/**
 * Add the same Gmail label(s) to many messages with one IMAP STORE command.
 * ImapFlow accepts a comma-delimited UID sequence, which avoids one network
 * round trip per message while preserving the single-message API above.
 */
export async function addLabelsToMessages(email, password, uids, labelNames, mailboxPath = ALL_MAIL_PATH) {
	const tokens = (labelNames || []).map(toImapLabelToken).filter(Boolean);
	const uidSet = [...new Set((uids || []).map(Number).filter(Number.isFinite))].join(',');
	if (!tokens.length || !uidSet) return;
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		await client.messageFlagsAdd(uidSet, tokens, { uid: true, useLabels: true });
	});
}

export async function removeLabelsFromMessage(email, password, uid, labelNames, mailboxPath = ALL_MAIL_PATH) {
	const tokens = (labelNames || []).map(toImapLabelToken).filter(Boolean);
	if (!tokens.length) return;
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		await client.messageFlagsRemove(String(uid), tokens, { uid: true, useLabels: true });
	});
}

/**
 * Fetch one page of messages from a folder-specific Gmail mailbox.
 */
export async function fetchMailboxPage(email, password, folder, page, pageSize, applierName) {
	const mailboxPath = folderToMailbox(folder);
	return withMailboxPath(email, password, mailboxPath, async (client) => {
		const total = client.mailbox.exists ?? 0;
		if (total === 0) return { messages: [], total: 0 };

		const size = Math.min(Math.max(pageSize, 1), 100);
		const end = total - (page - 1) * size;
		const start = Math.max(1, end - size + 1);
		if (end < 1) return { messages: [], total };

		const messages = [];
		for await (const message of client.fetch(`${start}:${end}`, {
			envelope: true,
			flags: true,
			uid: true,
			labels: true,
		})) {
			const doc = messageToDoc(message, applierName, mailboxPath);
			doc.folder = folder;
			messages.push(doc);
		}
		messages.reverse();
		return { messages, total, mailbox: mailboxPath };
	});
}

/**
 * Live folder totals from Gmail (total + unread per folder).
 */
export async function fetchFolderCounts(email, password) {
	// Use the pool directly without a pre-selected mailbox — we need to
	// visit multiple mailboxes to count each folder.
	return withPooledClient(email, password, undefined, async (client) => {
		const counts = {};
		for (const [folder, path] of Object.entries(FOLDER_MAILBOX)) {
			const lock = await client.getMailboxLock(path);
			try {
				const total = client.mailbox.exists ?? 0;
				const unseen = await client.search({ unseen: true });
				const unread = Array.isArray(unseen) ? unseen.length : 0;
				counts[folder] = {
					total,
					unread,
					badge: unread,
				};
			} finally {
				lock.release();
			}
		}
		return counts;
	});
}

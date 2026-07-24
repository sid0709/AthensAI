import { resolveMailCredentials, findAccountByApplierName } from '../services/mail/credentials.js';
import {
	archiveMessage,
	setMessageFlagged,
	setMessageSeen,
	trashMessage,
	moveToInbox,
	fetchGmailLabelList,
	createGmailLabel,
	deleteGmailLabel,
	addLabelsToMessage,
	removeLabelsFromMessage,
	fetchRecentInboxWithBodies,
} from '../services/mail/imapClient.js';
import { sendMail } from '../services/mail/smtpClient.js';
import {
	getMessage,
	messageToThread,
	updateMessageFlags,
	getSyncState,
	upsertSyncState,
	getUserLabelDefinitions,
	saveUserLabelDefinitions,
	normalizeLabelDefinitions,
} from '../services/mail/mailStore.js';
import { mailMessagesCollection, mailUserLabelsCollection } from '../db/mongo.js';
import {
	ensureMessageBody,
	runIncrementalSync,
	loadFolderPage,
	loadCachedFolderPage,
	loadLabelOrSearchPage,
	getFolderCounts,
	prefetchMessageBodies,
	folderToMailbox,
} from '../services/mail/mailSyncService.js';
import { ALL_MAIL_PATH } from '../services/mail/folderMapper.js';
import { aiExtractVerification } from '../services/mail/aiVerificationExtract.js';
import { runMailAiLabelBatch } from '../services/mail/aiLabelService.js';
import { runMailAiWrite } from '../services/mail/aiWriteService.js';
import { decryptProfileApiKeys } from '../services/autoBidProfileSecrets.js';
import { isBetaTier } from '../lib/betaTier.js';

const OTP_EMAIL_LIMIT = 10;
const mailLabelMemoryCache = new Map();

/** Newest-first slice — index 0 is the most recent message. */
function takeNewestEmails(docs, limit = OTP_EMAIL_LIMIT) {
	return [...docs]
		.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
		.slice(0, limit);
}

function parsePageQuery(req) {
	const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
	const pageSize = Math.min(
		100,
		Math.max(1, Number.parseInt(String(req.query.pageSize || '25'), 10) || 25),
	);
	return { page, pageSize };
}

export async function getMailThreads(req, res) {
	try {
		if (!mailMessagesCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const folder = req.query.folder ? String(req.query.folder) : 'inbox';
		const label = req.query.label ? String(req.query.label) : undefined;
		const search = req.query.search ? String(req.query.search) : undefined;
		const unlabeled = req.query.unlabeled === 'true' || req.query.unlabeled === '1';
		if (unlabeled) {
			const acc = await findAccountByApplierName(applierName);
			if (!isBetaTier(acc?.tier)) {
				return res.status(403).json({
					success: false,
					error: 'Beta workspace required.',
					betaRequired: true,
				});
			}
		}
		const { page, pageSize } = parsePageQuery(req);
		const cacheOnly = req.query.cacheOnly === 'true' || req.query.cacheOnly === '1';
		const forceRefresh = req.query.force === 'true' || req.query.force === '1';

		let result;
		if (cacheOnly) {
			if (label || search || unlabeled) {
				result = await loadLabelOrSearchPage(applierName, {
					folder: unlabeled ? 'inbox' : folder,
					label,
					search,
					unlabeled,
					page,
					pageSize,
				});
				result.fromCache = true;
			} else {
				result = await loadCachedFolderPage(applierName, folder, page, pageSize);
			}
		} else if (label || search || unlabeled) {
			result = await loadLabelOrSearchPage(applierName, {
				folder: unlabeled ? 'inbox' : folder,
				label,
				search,
				unlabeled,
				page,
				pageSize,
			});
		} else {
			result = await loadFolderPage(applierName, folder, page, pageSize, { forceRefresh });
		}

		if (!result.ok) {
			return res.status(500).json({ success: false, error: result.error });
		}

		if (!cacheOnly) {
			const uids = result.threads.map((t) => Number(t.uid)).filter(Boolean);
			const mailbox = folderToMailbox(folder);
			void prefetchMessageBodies(applierName, uids, mailbox);
		}

		return res.json({
			success: true,
			threads: result.threads,
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
			fromCache: result.fromCache ?? false,
		});
	} catch (err) {
		console.error('GET /api/mail/threads error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

async function requireApplier(req, res) {
	const applierName = String(req.query?.applierName || req.body?.applierName || '').trim();
	if (!applierName) {
		res.status(400).json({ success: false, error: 'applierName required' });
		return null;
	}
	const acc = await findAccountByApplierName(applierName);
	if (!acc) {
		res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		return null;
	}
	return applierName;
}

async function requireBetaApplier(req, res) {
	const applierName = await requireApplier(req, res);
	if (!applierName) return null;
	const acc = await findAccountByApplierName(applierName);
	if (!isBetaTier(acc?.tier)) {
		res.status(403).json({
			success: false,
			error: 'Beta workspace required.',
			betaRequired: true,
		});
		return null;
	}
	return applierName;
}

export async function getMailMessage(req, res) {
	try {
		if (!mailMessagesCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const uid = Number(req.params.uid);
		if (!Number.isFinite(uid)) {
			return res.status(400).json({ success: false, error: 'Invalid message uid' });
		}

		const folder = req.query.folder ? String(req.query.folder) : 'inbox';
		const mailbox = folderToMailbox(folder);

		let doc = await getMessage(applierName, uid, mailbox);
		if (!doc) {
			return res.status(404).json({ success: false, error: 'Message not found' });
		}

		if (doc.hasBody && (doc.bodyHtml || doc.bodyText)) {
			return res.json({
				success: true,
				thread: messageToThread(doc),
				fromCache: true,
			});
		}

		const bodyResult = await ensureMessageBody(applierName, uid, doc.mailbox || mailbox);
		if (bodyResult.ok && bodyResult.message) {
			doc = bodyResult.message;
		}

		return res.json({
			success: true,
			thread: messageToThread(doc),
			fromCache: bodyResult.fromCache ?? false,
		});
	} catch (err) {
		console.error('GET /api/mail/messages/:uid error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function syncMail(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		const result = await runIncrementalSync(applierName);
		if (!result.ok) {
			return res.status(500).json({ success: false, error: result.error });
		}
		return res.json({
			success: true,
			skipped: result.skipped ?? false,
			newCount: result.newCount ?? 0,
			updatedCount: result.updatedCount ?? 0,
		});
	} catch (err) {
		console.error('POST /api/mail/sync error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

/**
 * POST /api/mail/verification-code — sync inbox, send the 10 newest emails to AI,
 * and return the best-matching application verification code for the given company/role.
 * Body: { applierName, companyName?, jobTitle? }.
 */
export async function getVerificationCode(req, res) {
	try {
		if (!mailMessagesCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const companyName = String(req.body?.companyName || '').trim();
		const jobTitle = String(req.body?.jobTitle || '').trim();

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		// Read the newest INBOX emails DIRECTLY from Gmail. An OTP code MUST come from
		// the live mailbox: the synced Mongo cache can lag or hold a stale/empty body
		// for a just-arrived message, and typing a wrong/old code is worse than
		// reporting "not found". So there is intentionally NO cache fallback here — if
		// the live IMAP read fails, we return no code and let the caller retry.
		let emails = [];
		try {
			const live = await fetchRecentInboxWithBodies(creds.email, creds.password, OTP_EMAIL_LIMIT);
			emails = live.map((m) => ({
				from: m.fromName ? `${m.fromName} <${m.from}>` : m.from,
				subject: m.subject || '',
				snippet: '',
				body: m.bodyText || m.bodyHtml || '',
				date: m.date,
			}));
		} catch (err) {
			console.warn('[verification-code] live IMAP fetch failed (no cache fallback for OTP):', err.message);
			return res.json({
				success: true,
				code: null,
				link: null,
				scanned: 0,
				emails: [],
				via: 'imap',
				debug: { selectedIndex: null, aiFound: false, note: `live Gmail read failed: ${err.message}` },
			});
		}

		// Compact list of what we actually read — surfaced to the client so the
		// Agent-page Activity shows exactly which emails were scanned (titles/senders).
		const scannedEmails = emails.map((e, i) => ({
			index: i,
			from: String(e.from || ''),
			subject: String(e.subject || ''),
			date: e.date ? new Date(e.date).toISOString() : null,
		}));

		if (emails.length === 0) {
			console.log('[verification-code] live Gmail inbox empty for', applierName);
			return res.json({
				success: true,
				code: null,
				link: null,
				scanned: 0,
				emails: [],
				via: 'imap',
				debug: { selectedIndex: null, aiFound: false, note: 'live Gmail inbox returned no messages' },
			});
		}

		console.log(
			`[verification-code] scanning ${emails.length} newest live email(s) for ${applierName}:`,
			scannedEmails.map((e) => `#${e.index} ${e.date} "${e.subject}"`).join(' | '),
		);

		const acc = await findAccountByApplierName(applierName);
		const ai = await aiExtractVerification(emails, await decryptProfileApiKeys(acc?.autoBidProfile || {}), {
			companyName,
			jobTitle,
			applierName,
		});

		const debug = {
			selectedIndex: Number.isInteger(ai.emailIndex) ? ai.emailIndex : null,
			aiFound: Boolean(ai.found),
			note: ai.note || null,
		};

		if (ai.found && (ai.code || ai.link)) {
			const idx = Number.isInteger(ai.emailIndex) ? ai.emailIndex : 0;
			const src = emails[idx] ?? emails[0];
			return res.json({
				success: true,
				code: ai.code,
				link: ai.link,
				subject: src?.subject || null,
				from: src?.from || null,
				date: src?.date || null,
				via: 'imap',
				scanned: emails.length,
				emails: scannedEmails,
				debug,
			});
		}

		return res.json({ success: true, code: null, link: null, scanned: emails.length, emails: scannedEmails, debug, via: 'imap' });
	} catch (err) {
		console.error('POST /api/mail/verification-code error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function syncMailInitial(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const folder = req.body?.folder ? String(req.body.folder) : 'inbox';
		const page = Math.max(1, Number(req.body?.page) || 1);
		const pageSize = Math.min(100, Math.max(1, Number(req.body?.pageSize) || 25));

		const result = await loadFolderPage(applierName, folder, page, pageSize);
		if (!result.ok) {
			return res.status(500).json({ success: false, error: result.error });
		}
		return res.json({
			success: true,
			threads: result.threads,
			total: result.total,
			page: result.page,
			pageSize: result.pageSize,
		});
	} catch (err) {
		console.error('POST /api/mail/sync/initial error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function syncMailOlder(req, res) {
	return res.json({ success: true, newCount: 0, hasMore: false, message: 'Use page navigation instead' });
}

export async function getMailFolderCounts(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const force = req.query.force === 'true' || req.query.force === '1';
		const result = await getFolderCounts(applierName, { force });
		if (!result.ok) {
			return res.status(500).json({ success: false, error: result.error });
		}
		return res.json({ success: true, counts: result.counts, cached: result.cached ?? false });
	} catch (err) {
		console.error('GET /api/mail/folder-counts error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function sendMailMessage(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		const { to, subject, body, replyToUid } = req.body || {};
		if (!String(to || '').trim() || !String(subject || '').trim()) {
			return res.status(400).json({ success: false, error: 'to and subject are required' });
		}

		let inReplyTo;
		let references;
		if (replyToUid) {
			const replyFolder = req.body?.sourceFolder ? String(req.body.sourceFolder) : 'inbox';
			const original = await getMessage(
				applierName,
				Number(replyToUid),
				folderToMailbox(replyFolder),
			);
			if (original?.messageId) {
				inReplyTo = original.messageId;
				references = original.messageId;
			}
		}

		const result = await sendMail({
			email: creds.email,
			password: creds.password,
			to: String(to).trim(),
			subject: String(subject).trim(),
			body: String(body || ''),
			inReplyTo,
			references,
		});

		return res.json({ success: true, messageId: result.messageId });
	} catch (err) {
		console.error('POST /api/mail/send error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function patchMailMessage(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		const uid = Number(req.params.uid);
		if (!Number.isFinite(uid)) {
			return res.status(400).json({ success: false, error: 'Invalid message uid' });
		}

		const { seen, flagged, folder, addLabels, removeLabels, sourceFolder } = req.body || {};
		const lookupFolder = sourceFolder ? String(sourceFolder) : folder ? String(folder) : 'inbox';
		let doc = await getMessage(applierName, uid, folderToMailbox(lookupFolder));
		if (!doc) {
			return res.status(404).json({ success: false, error: 'Message not found' });
		}

		const mailbox = doc.mailbox || ALL_MAIL_PATH;
		const patch = {};

		if (seen !== undefined) {
			await setMessageSeen(creds.email, creds.password, uid, Boolean(seen), mailbox);
			patch.flags = { ...doc.flags, seen: Boolean(seen) };
		}

		if (flagged !== undefined) {
			await setMessageFlagged(creds.email, creds.password, uid, Boolean(flagged), mailbox);
			patch.flags = { ...(patch.flags || doc.flags), flagged: Boolean(flagged) };
		}

		if (addLabels?.length || removeLabels?.length) {
			if (addLabels?.length) {
				await addLabelsToMessage(creds.email, creds.password, uid, addLabels, mailbox);
			}
			if (removeLabels?.length) {
				await removeLabelsFromMessage(creds.email, creds.password, uid, removeLabels, mailbox);
			}
			const { fetchFlagsForUids } = await import('../services/mail/imapClient.js');
			const refreshed = await fetchFlagsForUids(creds.email, creds.password, [uid], applierName, mailbox);
			if (refreshed[0]) {
				patch.gmailLabels = refreshed[0].gmailLabels;
				patch.labels = refreshed[0].labels;
				patch.folder = refreshed[0].folder;
				patch.flags = refreshed[0].flags;
			}
		}

		if (folder !== undefined) {
			if (folder === 'archive') {
				await archiveMessage(creds.email, creds.password, uid, mailbox);
				patch.folder = 'archive';
			} else if (folder === 'trash') {
				await trashMessage(creds.email, creds.password, uid, mailbox);
				patch.folder = 'trash';
			} else if (folder === 'inbox') {
				await moveToInbox(creds.email, creds.password, uid, mailbox);
				patch.folder = 'inbox';
			} else {
				patch.folder = folder;
			}
		}

		const updated = await updateMessageFlags(applierName, uid, patch, mailbox);

		if (seen !== undefined || folder !== undefined) {
			await upsertSyncState(applierName, { folderCountsUpdatedAt: null });
		}

		return res.json({ success: true, thread: messageToThread(updated) });
	} catch (err) {
		console.error('PATCH /api/mail/messages/:uid error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function getMailLabels(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;
		const memoryKey = applierName.trim().toLowerCase();
		const memoryEntry = mailLabelMemoryCache.get(memoryKey);
		if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
			return res.json({ success: true, labels: memoryEntry.labels, cached: true });
		}

		const state = await getSyncState(applierName);
		const cachedAt = state?.gmailLabelsUpdatedAt ? new Date(state.gmailLabelsUpdatedAt).getTime() : 0;
		const cacheMs = Math.max(10_000, Number(process.env.MAIL_LABEL_CACHE_MS || 5 * 60 * 1000));
		if (Array.isArray(state?.gmailLabels) && Date.now() - cachedAt < cacheMs) {
			mailLabelMemoryCache.set(memoryKey, { labels: state.gmailLabels, expiresAt: Date.now() + cacheMs });
			return res.json({ success: true, labels: state.gmailLabels, cached: true });
		}

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		try {
			const labels = await fetchGmailLabelList(creds.email, creds.password);
			mailLabelMemoryCache.set(memoryKey, { labels, expiresAt: Date.now() + cacheMs });
			void upsertSyncState(applierName, { gmailLabels: labels, gmailLabelsUpdatedAt: new Date() })
				.catch((error) => console.warn('[mail] background label cache write failed:', error?.message || error));
			return res.json({ success: true, labels, cached: false });
		} catch (error) {
			if (Array.isArray(state?.gmailLabels)) {
				mailLabelMemoryCache.set(memoryKey, { labels: state.gmailLabels, expiresAt: Date.now() + Math.min(cacheMs, 60_000) });
				return res.json({ success: true, labels: state.gmailLabels, cached: true, stale: true });
			}
			throw error;
		}
	} catch (err) {
		console.error('GET /api/mail/labels error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function postMailLabel(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		const name = String(req.body?.name || '').trim();
		if (!name) {
			return res.status(400).json({ success: false, error: 'Label name required' });
		}

		let parentPath;
		if (req.body?.parentId) {
			const existing = await fetchGmailLabelList(creds.email, creds.password);
			const parent = existing.find((l) => l.id === req.body.parentId);
			parentPath = parent?.path || parent?.name;
		}

		const label = await createGmailLabel(creds.email, creds.password, name, parentPath);
		return res.json({ success: true, label });
	} catch (err) {
		console.error('POST /api/mail/labels error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function deleteMailLabel(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		const labelId = String(req.params.labelId || '').trim();
		if (!labelId) {
			return res.status(400).json({ success: false, error: 'Label id required' });
		}

		const labels = await fetchGmailLabelList(creds.email, creds.password);
		const label = labels.find((l) => l.id === labelId);
		if (!label) {
			return res.status(404).json({ success: false, error: 'Label not found' });
		}

		await deleteGmailLabel(creds.email, creds.password, label.path || label.name);
		return res.json({ success: true, deleted: label.path || label.name });
	} catch (err) {
		console.error('DELETE /api/mail/labels/:labelId error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function putMailLabels(req, res) {
	// Legacy — redirect clients to POST /mail/labels for create
	return res.status(400).json({
		success: false,
		error: 'Use POST /api/mail/labels to create a Gmail label.',
	});
}

export async function checkMailCredentials(req, res) {
	try {
		const applierName = await requireApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.json({ success: true, configured: false, error: creds.error });
		}
		return res.json({ success: true, configured: true, email: creds.email });
	} catch (err) {
		console.error('GET /api/mail/credentials error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function getMailLabelDefinitions(req, res) {
	try {
		const applierName = await requireBetaApplier(req, res);
		if (!applierName) return;

		if (!mailUserLabelsCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}

		const acc = await findAccountByApplierName(applierName);
		if (!acc) {
			return res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		}

		const definitions = await getUserLabelDefinitions(
			applierName,
			acc.autoBidProfile?.mailLabelDefinitions,
		);
		return res.json({ success: true, definitions });
	} catch (err) {
		console.error('GET /api/mail/label-definitions error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function putMailLabelDefinitions(req, res) {
	try {
		const applierName = await requireBetaApplier(req, res);
		if (!applierName) return;

		if (!mailUserLabelsCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}

		const acc = await findAccountByApplierName(applierName);
		if (!acc) {
			return res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		}

		const definitions = await saveUserLabelDefinitions(applierName, req.body?.definitions);
		return res.json({ success: true, definitions });
	} catch (err) {
		console.error('PUT /api/mail/label-definitions error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function postMailAiLabel(req, res) {
	try {
		if (!mailMessagesCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}

		const applierName = await requireBetaApplier(req, res);
		if (!applierName) return;

		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) {
			return res.status(400).json({ success: false, error: creds.error, credentialsMissing: true });
		}

		const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
		if (!rawMessages.length) {
			return res.status(400).json({ success: false, error: 'messages array required' });
		}
		if (rawMessages.length > 50) {
			return res.status(400).json({ success: false, error: 'Maximum 50 messages per batch' });
		}

		const acc = await findAccountByApplierName(applierName);
		const profile = await decryptProfileApiKeys(acc?.autoBidProfile || {});
		const storedDefinitions = await getUserLabelDefinitions(
			applierName,
			acc?.autoBidProfile?.mailLabelDefinitions,
		);
		const labelDefinitions = normalizeLabelDefinitions(
			req.body?.labelDefinitions || storedDefinitions,
		);

		const gmailLabels = await fetchGmailLabelList(creds.email, creds.password);
		const allowedLabels = gmailLabels.map((l) => l.path || l.name).filter(Boolean);
		if (!allowedLabels.length) {
			return res.status(400).json({ success: false, error: 'No custom Gmail labels found. Create labels first.' });
		}

		const messages = rawMessages
			.map((m) => ({
				uid: Number(m.uid),
				mailbox: typeof m.mailbox === 'string' ? m.mailbox : undefined,
			}))
			.filter((m) => Number.isFinite(m.uid));

		const result = await runMailAiLabelBatch({
			applierName,
			profile,
			email: creds.email,
			password: creds.password,
			messages,
			allowedLabels,
			labelDefinitions,
		});

		if (!result.ok) {
			return res.status(400).json({ success: false, error: result.error });
		}

		return res.json({
			success: true,
			results: result.results,
			usage: result.usage,
		});
	} catch (err) {
		console.error('POST /api/mail/ai-label error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function postMailAiWrite(req, res) {
	try {
		const applierName = await requireBetaApplier(req, res);
		if (!applierName) return;

		const acc = await findAccountByApplierName(applierName);
		if (!acc) {
			return res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		}

		const profile = await decryptProfileApiKeys(acc.autoBidProfile || {});
		const mode =
			req.body?.mode === 'fine-tune'
				? 'fine-tune'
				: req.body?.mode === 'reply'
					? 'reply'
					: 'write';
		const result = await runMailAiWrite(
			{
				mode,
				prompt: req.body?.prompt,
				body: req.body?.body,
				subject: req.body?.subject,
				replyContext: req.body?.replyContext,
			},
			profile,
			{ applierName },
		);

		if (!result.ok) {
			return res.status(400).json({ success: false, error: result.error });
		}

		return res.json({ success: true, body: result.body, usage: result.usage });
	} catch (err) {
		console.error('POST /api/mail/ai-write error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

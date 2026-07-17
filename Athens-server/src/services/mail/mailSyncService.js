import { resolveMailCredentials } from './credentials.js';
import {
	fetchFlagsForUids,
	fetchMessageBody,
	fetchMessagePlainText,
	fetchMailboxPage,
	fetchNewEnvelopes,
	fetchFolderCounts,
} from './imapClient.js';
import {
	acquireSyncLock,
	canSync,
	countMessages,
	getRecentUidsForFlagRefresh,
	getSyncState,
	listMessages,
	releaseSyncLock,
	upsertMessages,
	upsertSyncState,
	messageToThread,
	getMessagesByUids,
	enrichMessagesFromCache,
	updateMessagePlainText,
} from './mailStore.js';
import { ALL_MAIL_PATH, folderToMailbox } from './folderMapper.js';

const CACHE_STALE_MS = 2 * 60 * 1000; // 2 min before background IMAP refresh
const FOLDER_COUNT_CACHE_MS = 5 * 60 * 1000; // 5 min before refreshing folder counts

/**
 * Read one folder page from MongoDB cache only (instant).
 */
export async function loadCachedFolderPage(applierName, folder, page, pageSize) {
	const mailbox = folderToMailbox(folder);
	const state = await getSyncState(applierName);
	const cachedTotal = state?.[`folderTotal_${folder}`];
	const mongoCount = await countMessages(applierName, { folder, mailbox });
	const total =
		typeof cachedTotal === 'number' && cachedTotal > 0 ? cachedTotal : mongoCount;

	const docs = await listMessages(applierName, { folder, mailbox, page, pageSize });
	return {
		ok: true,
		threads: docs.map((doc) => messageToThread(doc, { includeBody: false })),
		total,
		page,
		pageSize,
		fromCache: true,
	};
}

/**
 * Fetch one folder page from Gmail if not fully cached; returns threads + total.
 *
 * Smart cache policy:
 *  - If MongoDB has data AND the folder was refreshed < CACHE_STALE_MS ago →
 *    serve from cache immediately, no IMAP call — unless the page is underfilled.
 *  - If MongoDB has data but cache is stale → serve from cache immediately, then
 *    fire-and-forget an IMAP refresh in the background (unless underfilled → sync IMAP).
 *  - If MongoDB has NO data (first load) OR forceRefresh is true → hit IMAP
 *    synchronously.
 *  - If cache returns fewer rows than expected for the page while more messages
 *    exist, fall through to synchronous IMAP for the requested page/size.
 */
export async function loadFolderPage(applierName, folder, page, pageSize, { forceRefresh = false } = {}) {
	const state = await getSyncState(applierName);
	const lastRefreshKey = `folderRefreshedAt_${folder}`;
	const lastRefreshed = state?.[lastRefreshKey] ? new Date(state[lastRefreshKey]).getTime() : 0;
	const cacheAge = Date.now() - lastRefreshed;
	const cacheIsFresh = cacheAge < CACHE_STALE_MS;

	const mailboxPath = folderToMailbox(folder);
	const cachedCount = await countMessages(applierName, { folder, mailbox: mailboxPath });
	const hasCachedData = cachedCount > 0;

	const cacheUnderfilled = (cached) => {
		const folderTotal =
			typeof state?.[`folderTotal_${folder}`] === 'number' ? state[`folderTotal_${folder}`] : cachedCount;
		const expectedOnPage = Math.max(0, Math.min(pageSize, folderTotal - (page - 1) * pageSize));
		return expectedOnPage > 0 && cached.threads.length < expectedOnPage;
	};

	// If cache is fresh AND not forced → try MongoDB first
	if (!forceRefresh && hasCachedData && cacheIsFresh) {
		const cached = await loadCachedFolderPage(applierName, folder, page, pageSize);
		if (!cacheUnderfilled(cached)) {
			return cached;
		}
		// Fall through to IMAP to fill the requested page
	}

	// If we have cached data but it's stale → serve cache + background refresh,
	// unless the page is underfilled (then sync IMAP for this page).
	if (!forceRefresh && hasCachedData) {
		const cached = await loadCachedFolderPage(applierName, folder, page, pageSize);
		if (!cacheUnderfilled(cached)) {
			refreshFolderInBackground(applierName, folder, pageSize);
			return cached;
		}
		// Fall through to IMAP
	}

	// No cached data, forced refresh, or underfilled cache → hit IMAP synchronously
	const creds = await resolveMailCredentials(applierName);
	if (!creds.ok) return { ok: false, error: creds.error };

	try {
		const { messages, total } = await fetchMailboxPage(
			creds.email,
			creds.password,
			folder,
			page,
			pageSize,
			applierName,
		);

		if (messages.length) {
			await upsertMessages(messages);
		}

		await upsertSyncState(applierName, {
			[`folderTotal_${folder}`]: total,
			[lastRefreshKey]: new Date(),
		});

		const uids = messages.map((m) => m.uid);
		const cachedDocs = uids.length
			? await getMessagesByUids(applierName, uids, mailboxPath)
			: [];
		const enriched = enrichMessagesFromCache(messages, cachedDocs);

		return {
			ok: true,
			threads: enriched.map((doc) => messageToThread(doc, { includeBody: false })),
			total,
			page,
			pageSize,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

/**
 * Background IMAP refresh — fetches the latest page from Gmail and upserts into
 * MongoDB. Errors are silently swallowed (the UI already has cached data).
 */
async function refreshFolderInBackground(applierName, folder, pageSize) {
	try {
		const creds = await resolveMailCredentials(applierName);
		if (!creds.ok) return;

		const { messages, total } = await fetchMailboxPage(
			creds.email,
			creds.password,
			folder,
			1, // always refresh page 1 (newest messages)
			pageSize || 25,
			applierName,
		);

		if (messages.length) {
			await upsertMessages(messages);
		}

		await upsertSyncState(applierName, {
			[`folderTotal_${folder}`]: total,
			[`folderRefreshedAt_${folder}`]: new Date(),
		});
	} catch {
		// Silently ignore — the UI already has cached data
	}
}

export async function loadLabelOrSearchPage(applierName, { folder, label, search, unlabeled, page, pageSize }) {
	const total = await countMessages(applierName, { folder, label, search, unlabeled });
	const docs = await listMessages(applierName, { folder, label, search, unlabeled, page, pageSize });
	return {
		ok: true,
		threads: docs.map((doc) => messageToThread(doc, { includeBody: false })),
		total,
		page,
		pageSize,
	};
}

/**
 * Get folder counts. Serves from cache sync state (instant MongoDB read) unless
 * the cache is older than 5 minutes or force=true. Only then does it hit IMAP.
 */
export async function getFolderCounts(applierName, { force = false } = {}) {
	const state = await getSyncState(applierName);

	// Use cached counts when fresh enough
	if (!force && state?.folderCounts && state?.folderCountsUpdatedAt) {
		const age = Date.now() - new Date(state.folderCountsUpdatedAt).getTime();
		if (age < FOLDER_COUNT_CACHE_MS) {
			return { ok: true, counts: state.folderCounts, cached: true };
		}
	}

	const creds = await resolveMailCredentials(applierName);
	if (!creds.ok) {
		// Fall back to stale cache if credentials unavailable
		if (state?.folderCounts) {
			return { ok: true, counts: state.folderCounts, cached: true };
		}
		return { ok: false, error: creds.error };
	}

	try {
		const counts = await fetchFolderCounts(creds.email, creds.password);
		await upsertSyncState(applierName, { folderCounts: counts, folderCountsUpdatedAt: new Date() });
		return { ok: true, counts };
	} catch (err) {
		// Fall back to stale cache on IMAP failure
		if (state?.folderCounts) {
			return { ok: true, counts: state.folderCounts, cached: true };
		}
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

export async function runIncrementalSync(applierName, { force = false } = {}) {
	const creds = await resolveMailCredentials(applierName);
	if (!creds.ok) return { ok: false, error: creds.error };

	if (!(await canSync(applierName, force))) {
		return { ok: true, skipped: true, newCount: 0, updatedCount: 0 };
	}

	if (!(await acquireSyncLock(applierName))) {
		return { ok: true, skipped: true, newCount: 0, updatedCount: 0 };
	}

	try {
		const state = await getSyncState(applierName);
		let newCount = 0;
		let updatedCount = 0;

		const { messages, highestUid } = await fetchNewEnvelopes(
			creds.email,
			creds.password,
			state.highestUid || 0,
			applierName,
		);
		if (messages.length) {
			const result = await upsertMessages(messages);
			newCount = result.upserted;
		}

		const recentUids = await getRecentUidsForFlagRefresh(applierName);
		if (recentUids.length) {
			const flagUpdates = await fetchFlagsForUids(
				creds.email,
				creds.password,
				recentUids,
				applierName,
				ALL_MAIL_PATH,
			);
			if (flagUpdates.length) {
				const result = await upsertMessages(flagUpdates);
				updatedCount = result.upserted;
			}
		}

		await releaseSyncLock(applierName, {
			highestUid: Math.max(state.highestUid || 0, highestUid),
			lastImapSyncAt: new Date(),
			lastError: null,
			initialSyncComplete: true,
		});

		return { ok: true, newCount, updatedCount };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await releaseSyncLock(applierName, { lastError: message });
		return { ok: false, error: message };
	}
}

/** @deprecated Use loadFolderPage instead */
export async function runInitialSync(applierName, opts = {}) {
	return loadFolderPage(applierName, 'inbox', 1, 25);
}

/** @deprecated Use loadFolderPage instead */
export async function runOlderSync(applierName, batchSize) {
	return { ok: true, newCount: 0, hasMore: false };
}

export async function ensureMessageBody(applierName, uid, mailbox) {
	const creds = await resolveMailCredentials(applierName);
	if (!creds.ok) return { ok: false, error: creds.error };

	const { getMessage, updateMessageBody } = await import('./mailStore.js');
	const mailboxPath = mailbox || ALL_MAIL_PATH;
	const existing = await getMessage(applierName, uid, mailboxPath);

	// Mongo cache hit — skip IMAP entirely (mailbox-scoped keys prevent wrong-body reuse).
	if (existing?.hasBody && (existing.bodyHtml || existing.bodyText)) {
		return { ok: true, message: existing, fromCache: true };
	}

	try {
		const body = await fetchMessageBody(creds.email, creds.password, uid, mailboxPath);
		const updated = await updateMessageBody(applierName, uid, {
			bodyText: body.bodyText,
			bodyHtml: body.bodyHtml,
			preview: body.preview,
			from: body.from,
			to: body.to,
			cc: body.cc,
			subject: body.subject,
			date: body.date,
			flags: body.flags,
			messageId: body.messageId || existing?.messageId || null,
		}, mailboxPath);
		return { ok: true, message: updated, fromCache: false };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

function usablePlainText(doc) {
	const text = String(doc?.bodyText || '').trim();
	if (text && text !== '(No text content)') return text;
	return '';
}

/**
 * Ensure plain-text body for AI labeling — skips full HTML MIME fetch/parse when possible.
 */
export async function ensureMessagePlainText(applierName, uid, mailbox) {
	const creds = await resolveMailCredentials(applierName);
	if (!creds.ok) return { ok: false, error: creds.error };

	const { getMessage } = await import('./mailStore.js');
	const mailboxPath = mailbox || ALL_MAIL_PATH;
	const existing = await getMessage(applierName, uid, mailboxPath);

	const cached = usablePlainText(existing);
	if (cached) {
		return { ok: true, message: existing, bodyText: cached, fromCache: true };
	}

	try {
		const plain = await fetchMessagePlainText(creds.email, creds.password, uid, mailboxPath);
		const updated = existing
			? await updateMessagePlainText(
					applierName,
					uid,
					{ bodyText: plain.bodyText, preview: plain.preview },
					mailboxPath,
				)
			: null;
		const message = updated || { ...(existing || {}), ...plain, uid: Number(uid), mailbox: mailboxPath };
		return { ok: true, message, bodyText: plain.bodyText, fromCache: false };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

/**
 * Prefetch bodies for visible page using a single IMAP connection (batched).
 * Caps at 10 bodies per batch to avoid IMAP timeouts on slow connections.
 */
export async function prefetchMessageBodies(applierName, uids, mailbox = ALL_MAIL_PATH) {
	if (!uids.length) return;

	const creds = await resolveMailCredentials(applierName);
	if (!creds.ok) return;

	const { getMessage } = await import('./mailStore.js');

	// Filter to UIDs that need body fetching
	const uncached = [];
	for (const uid of uids) {
		const existing = await getMessage(applierName, uid, mailbox);
		if (!existing?.hasBody) uncached.push(uid);
	}

	if (!uncached.length) return;

	// Fetch in batches of 10 within a single connection
	const BATCH_SIZE = 10;
	for (let i = 0; i < Math.min(uncached.length, BATCH_SIZE); i++) {
		try {
			await ensureMessageBody(applierName, uncached[i], mailbox);
		} catch {
			// best effort
		}
	}
}

export { folderToMailbox };

/**
 * Insert-only sync of job_market from MONGO_URL → MONGO_LOCAL_URL.
 * Copies remote jobs whose applyLink (or _id when no applyLink) is missing locally.
 *
 * Usage: node dump-jobs.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { MongoClient } from 'mongodb';

const BATCH = 1000;
const WRITE_CONCURRENCY = 6;
const PROGRESS_EVERY = 1000;
const COLLECTION = 'job_market';

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function sameTarget(remoteUrl, localUrl) {
	const normalize = (url) => url.replace(/\/+$/, '');
	return normalize(remoteUrl) === normalize(localUrl);
}

function renderProgress({ scanned, total, inserted, skipped }) {
	const pct = total > 0 ? ` ${Math.min(100, Math.floor((scanned / total) * 100))}%` : '';
	const denom = total > 0 ? `/${total}` : '';
	process.stdout.write(
		`\r[dump-jobs] scanned=${scanned}${denom}${pct} inserted=${inserted} skipped=${skipped}   `,
	);
}

async function insertBatch(localCol, docs) {
	try {
		const result = await localCol.insertMany(docs, { ordered: false });
		return { inserted: result.insertedCount, skipped: 0 };
	} catch (err) {
		if (err?.code === 11000 || Array.isArray(err?.writeErrors)) {
			const nInserted = err.result?.insertedCount ?? err.insertedCount ?? 0;
			const nErrors = err.writeErrors?.length ?? docs.length - nInserted;
			return { inserted: nInserted, skipped: Math.max(0, nErrors) };
		}
		throw err;
	}
}

async function main() {
	const remoteUrl = requireEnv('MONGO_URL');
	const localUrl = requireEnv('MONGO_LOCAL_URL');
	const dbName = process.env.MONGO_DB?.trim() || 'AthensDB';

	if (sameTarget(remoteUrl, localUrl)) {
		throw new Error(
			'MONGO_URL and MONGO_LOCAL_URL resolve to the same host — aborting',
		);
	}

	const clientOpts = {
		maxPoolSize: 24,
		minPoolSize: 2,
	};
	const remoteClient = new MongoClient(remoteUrl, clientOpts);
	const localClient = new MongoClient(localUrl, clientOpts);
	const started = Date.now();

	try {
		await Promise.all([remoteClient.connect(), localClient.connect()]);

		const remoteCol = remoteClient.db(dbName).collection(COLLECTION);
		const localCol = localClient.db(dbName).collection(COLLECTION);

		const [remoteTotal, localTotal] = await Promise.all([
			remoteCol.estimatedDocumentCount(),
			localCol.estimatedDocumentCount(),
		]);

		console.log(
			`[dump-jobs] Remote≈${remoteTotal} Local≈${localTotal} ` +
				`(write concurrency=${WRITE_CONCURRENCY})`,
		);

		const localApplyLinks = new Set();
		const localIds = new Set();
		let localLoaded = 0;

		const localCursor = localCol
			.find({}, { projection: { _id: 1, applyLink: 1 } })
			.batchSize(BATCH);
		try {
			for await (const doc of localCursor) {
				localLoaded += 1;
				if (typeof doc.applyLink === 'string' && doc.applyLink) {
					localApplyLinks.add(doc.applyLink);
				} else {
					localIds.add(String(doc._id));
				}
				if (localLoaded % PROGRESS_EVERY === 0) {
					process.stdout.write(
						`\r[dump-jobs] loading local keys… ${localLoaded}/${localTotal || '?'}   `,
					);
				}
			}
		} finally {
			await localCursor.close().catch(() => {});
		}
		process.stdout.write('\n');
		console.log(
			`[dump-jobs] Local keys: ${localApplyLinks.size} applyLink(s), ${localIds.size} linkless _id(s)`,
		);

		let scanned = 0;
		let inserted = 0;
		let skipped = 0;
		let lastRendered = 0;
		let batch = [];
		const inflight = new Set();

		const maybeRender = (force = false) => {
			if (!force && scanned - lastRendered < PROGRESS_EVERY) return;
			lastRendered = scanned;
			renderProgress({ scanned, total: remoteTotal, inserted, skipped });
		};

		const track = (promise) => {
			inflight.add(promise);
			promise.finally(() => inflight.delete(promise));
			return promise;
		};

		const flush = async () => {
			if (!batch.length) return;
			const docs = batch;
			batch = [];
			const p = track(
				insertBatch(localCol, docs).then((r) => {
					inserted += r.inserted;
					skipped += r.skipped;
					maybeRender(true);
				}),
			);
			if (inflight.size >= WRITE_CONCURRENCY) {
				await Promise.race(inflight);
			}
		};

		const remoteCursor = remoteCol.find({}).batchSize(BATCH);
		try {
			for await (const doc of remoteCursor) {
				scanned += 1;
				const link = typeof doc.applyLink === 'string' ? doc.applyLink : '';
				const exists = link
					? localApplyLinks.has(link)
					: localIds.has(String(doc._id));

				if (exists) {
					skipped += 1;
					maybeRender();
					continue;
				}

				batch.push(doc);
				if (link) localApplyLinks.add(link);
				else localIds.add(String(doc._id));

				if (batch.length >= BATCH) await flush();
				else maybeRender();
			}
			await flush();
			await Promise.all(inflight);
		} finally {
			await remoteCursor.close().catch(() => {});
		}

		renderProgress({ scanned, total: remoteTotal, inserted, skipped });
		process.stdout.write('\n');
		const secs = ((Date.now() - started) / 1000).toFixed(1);
		console.log(
			`[dump-jobs] Done in ${secs}s — scanned=${scanned} inserted=${inserted} skipped=${skipped}`,
		);
	} finally {
		await Promise.all([
			remoteClient.close().catch(() => {}),
			localClient.close().catch(() => {}),
		]);
	}
}

main().catch((err) => {
	console.error('\n[dump-jobs] Failed:', err.message || err);
	process.exit(1);
});

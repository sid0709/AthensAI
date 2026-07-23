/**
 * Wipe local AthensDB and clone all collections from MONGO_URL → MONGO_LOCAL_URL.
 *
 * Usage: node dump.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { MongoClient } from 'mongodb';

const BATCH = 1000;
const COL_CONCURRENCY = 4;
const WRITE_CONCURRENCY = 4;
const PROGRESS_EVERY = 2000;

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function sameTarget(remoteUrl, localUrl) {
	const normalize = (url) => url.replace(/\/+$/, '');
	return normalize(remoteUrl) === normalize(localUrl);
}

/** Run async work over items with a fixed worker pool. */
async function mapPool(items, concurrency, fn) {
	if (!items.length) return [];
	const results = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

function indexSpecsFromRemote(indexes) {
	return indexes
		.filter((idx) => idx.name !== '_id_')
		.map((idx) => {
			const spec = { key: idx.key, name: idx.name };
			if (idx.unique) spec.unique = true;
			if (idx.sparse) spec.sparse = true;
			if (idx.partialFilterExpression) {
				spec.partialFilterExpression = idx.partialFilterExpression;
			}
			if (idx.expireAfterSeconds != null) {
				spec.expireAfterSeconds = idx.expireAfterSeconds;
			}
			if (idx.collation) spec.collation = idx.collation;
			return spec;
		});
}

async function copyCollection(remoteCol, localDb, name) {
	const localCol = localDb.collection(name);
	const total = await remoteCol.estimatedDocumentCount();
	let inserted = 0;
	let lastLogged = 0;
	let batch = [];
	const inflight = new Set();

	const logProgress = (force = false) => {
		if (!force && inserted - lastLogged < PROGRESS_EVERY) return;
		lastLogged = inserted;
		const pct = total > 0 ? ` ${Math.min(100, Math.floor((inserted / total) * 100))}%` : '';
		const denom = total > 0 ? `/${total}` : '';
		console.log(`[dump] ${name}: ${inserted}${denom} docs${pct}`);
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
			localCol.insertMany(docs, { ordered: false }).then(() => {
				inserted += docs.length;
				logProgress();
			}),
		);
		if (inflight.size >= WRITE_CONCURRENCY) {
			await Promise.race(inflight);
		}
	};

	console.log(`[dump] ${name}: starting (${total} estimated)…`);

	const cursor = remoteCol.find({}).batchSize(BATCH);
	try {
		for await (const doc of cursor) {
			batch.push(doc);
			if (batch.length >= BATCH) await flush();
		}
		await flush();
		await Promise.all(inflight);
	} finally {
		await cursor.close().catch(() => {});
	}

	const indexes = await remoteCol.listIndexes().toArray();
	const toCreate = indexSpecsFromRemote(indexes);
	if (toCreate.length) {
		await localCol.createIndexes(toCreate);
	}

	logProgress(true);
	console.log(`[dump] ${name}: done (${inserted} document(s), ${toCreate.length} index(es))`);
	return inserted;
}

async function main() {
	const remoteUrl = requireEnv('MONGO_URL');
	const localUrl = requireEnv('MONGO_LOCAL_URL');
	const dbName = process.env.MONGO_DB?.trim() || 'AthensDB';

	if (sameTarget(remoteUrl, localUrl)) {
		throw new Error(
			'MONGO_URL and MONGO_LOCAL_URL resolve to the same host — aborting to avoid wiping the source',
		);
	}

	const clientOpts = {
		maxPoolSize: 32,
		minPoolSize: 4,
	};
	const remoteClient = new MongoClient(remoteUrl, clientOpts);
	const localClient = new MongoClient(localUrl, clientOpts);

	const started = Date.now();

	try {
		await Promise.all([remoteClient.connect(), localClient.connect()]);

		const remoteDb = remoteClient.db(dbName);
		const localDb = localClient.db(dbName);

		const localCols = await localDb.listCollections({}, { nameOnly: true }).toArray();
		const localNames = localCols
			.map((c) => c.name)
			.filter((name) => name && !name.startsWith('system.'));

		console.log(`[dump] Dropping ${localNames.length} local collection(s) in ${dbName}…`);
		await mapPool(localNames, COL_CONCURRENCY, async (name) => {
			await localDb.collection(name).drop().catch((err) => {
				if (err?.codeName !== 'NamespaceNotFound') throw err;
			});
			console.log(`[dump]   dropped ${name}`);
		});

		const remoteCols = await remoteDb.listCollections({}, { nameOnly: true }).toArray();
		const remoteNames = remoteCols
			.map((c) => c.name)
			.filter((name) => name && !name.startsWith('system.'))
			.sort((a, b) => a.localeCompare(b));

		console.log(
			`[dump] Copying ${remoteNames.length} collection(s) ` +
				`(collection concurrency=${COL_CONCURRENCY}, write concurrency=${WRITE_CONCURRENCY})…`,
		);

		const counts = await mapPool(remoteNames, COL_CONCURRENCY, async (name) =>
			copyCollection(remoteDb.collection(name), localDb, name),
		);

		const totalDocs = counts.reduce((a, b) => a + b, 0);
		const secs = ((Date.now() - started) / 1000).toFixed(1);
		console.log(`[dump] Done. ${totalDocs} document(s) in ${secs}s.`);
	} finally {
		await Promise.all([
			remoteClient.close().catch(() => {}),
			localClient.close().catch(() => {}),
		]);
	}
}

main().catch((err) => {
	console.error('[dump] Failed:', err.message || err);
	process.exit(1);
});

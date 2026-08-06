#!/usr/bin/env node
/**
 * High-throughput Firestore → MongoDB copy (database: AthensAI).
 *
 * Default mode is resume-safe (count check only — no full doc scan):
 *   - counts match  → skip collection
 *   - missing / mismatch → drop Mongo collection and re-copy
 *   - not copied yet → copy
 *
 * Optimizations:
 *   - Parallel collection workers (default 6)
 *   - Pipelined Firestore prefetch while Mongo writes
 *   - insertMany after drop/recreate (fast path)
 *   - No subcollection RPCs unless --deep
 *
 * Usage (from Athens-server/):
 *   node src/scripts/copyFirestoreToMongo.js
 *   node src/scripts/copyFirestoreToMongo.js --concurrency=8
 *   node src/scripts/copyFirestoreToMongo.js --drop          # force recreate all
 *   node src/scripts/copyFirestoreToMongo.js --collections=account_info,companies
 *   node src/scripts/copyFirestoreToMongo.js --deep
 *   node src/scripts/copyFirestoreToMongo.js --dry-run
 *
 * Env overrides:
 *   MONGO_COPY_URL, MONGO_COPY_DB
 *   FIRESTORE_PAGE_SIZE (default 1000)
 *   MONGO_BATCH_SIZE    (default 1000)
 *   COPY_CONCURRENCY    (default 6)
 *   WRITE_CONCURRENCY   (default 2 in-flight writes per collection)
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { getFirestoreDb, getFirebaseMeta } from "../services/firebase/firebaseAdmin.js";

const DEFAULT_MONGO_URL =
	process.env.MONGO_COPY_URL ||
	"mongodb://sid:Test.1234%21@45.61.176.179:27017/?authSource=admin";
const DEFAULT_DB = process.env.MONGO_COPY_DB || "AthensAI";
const PAGE_SIZE = Math.max(100, Number(process.env.FIRESTORE_PAGE_SIZE) || 1000);
const BATCH_SIZE = Math.max(100, Number(process.env.MONGO_BATCH_SIZE) || 1000);
const WRITE_CONCURRENCY = Math.max(1, Number(process.env.WRITE_CONCURRENCY) || 2);

const args = process.argv.slice(2);
const argSet = new Set(args);
const DROP = argSet.has("--drop");
const DEEP = argSet.has("--deep");
const DRY_RUN = argSet.has("--dry-run");

function readFlagValue(prefix, fallback) {
	const hit = args.find((a) => a.startsWith(prefix));
	if (!hit) return fallback;
	const n = Number(hit.slice(prefix.length));
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const CONCURRENCY = readFlagValue(
	"--concurrency=",
	Math.max(1, Number(process.env.COPY_CONCURRENCY) || 6),
);

const ONLY = (() => {
	const raw = args.find((a) => a.startsWith("--collections="));
	if (!raw) return null;
	return new Set(
		raw
			.slice("--collections=".length)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
})();

const startedAt = Date.now();
const stats = {
	collections: 0,
	docs: 0,
	bytesApprox: 0,
	errors: 0,
	skippedCollections: 0,
	skippedMatched: 0,
	recreated: 0,
};

function encodeMongoUrl(raw) {
	try {
		const match = String(raw).match(/^(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@(.+)$/);
		if (!match) return raw;
		const [, scheme, user, pass, rest] = match;
		if (/%[0-9A-Fa-f]{2}/.test(pass)) return raw;
		return `${scheme}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${rest}`;
	} catch {
		return raw;
	}
}

function maskUrl(url) {
	return String(url).replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
}

function fmtNum(n) {
	return Number(n || 0).toLocaleString("en-US");
}

function fmtDuration(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h) return `${h}h ${m}m ${sec}s`;
	if (m) return `${m}m ${sec}s`;
	return `${sec}s`;
}

function rate(docs, elapsedMs) {
	if (elapsedMs < 200) return 0;
	return Math.round((docs * 1000) / elapsedMs);
}

function shortName(path, max = 28) {
	if (path.length <= max) return path;
	return `${path.slice(0, max - 1)}…`;
}

function mongoCollectionName(firestoreCollectionPath) {
	const name = String(firestoreCollectionPath).replace(/\//g, "__");
	if (name.length <= 120) return name;
	return `${name.slice(0, 100)}__${Buffer.from(name).toString("base64url").slice(0, 16)}`;
}

function toMongoValue(value) {
	if (value === null || value === undefined) return value;

	if (typeof value?.toDate === "function") {
		try {
			return value.toDate();
		} catch {
			return String(value);
		}
	}

	if (
		typeof value?.latitude === "number" &&
		typeof value?.longitude === "number" &&
		value.constructor?.name === "GeoPoint"
	) {
		return { _type: "GeoPoint", latitude: value.latitude, longitude: value.longitude };
	}

	if (typeof value?.path === "string" && typeof value?.id === "string" && typeof value?.get === "function") {
		return { _type: "DocumentReference", path: value.path };
	}

	if (Buffer.isBuffer(value)) return value;

	if (Array.isArray(value)) return value.map(toMongoValue);

	if (value instanceof Map) {
		const out = {};
		for (const [k, v] of value.entries()) out[String(k)] = toMongoValue(v);
		return out;
	}

	if (typeof value === "object") {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) {
			if (typeof value.toJSON === "function") {
				try {
					return toMongoValue(value.toJSON());
				} catch {
					/* fall through */
				}
			}
			return { _type: value.constructor?.name || "Object", value: String(value) };
		}
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			if (v !== undefined) out[k] = toMongoValue(v);
		}
		return out;
	}

	return value;
}

function docToMongo(snap) {
	const data = snap.data() || {};
	return {
		_id: snap.id,
		...toMongoValue(data),
		_firestorePath: snap.ref.path,
		_firestoreCreateTime: snap.createTime?.toDate?.() || null,
		_firestoreUpdateTime: snap.updateTime?.toDate?.() || null,
	};
}

function approxSize(doc) {
	try {
		return Buffer.byteLength(JSON.stringify(doc), "utf8");
	} catch {
		return 0;
	}
}

/** Live progress hub safe for parallel collection workers. */
class ProgressHub {
	constructor() {
		this.active = new Map();
		this.totalDone = 0;
		this.lastDraw = 0;
		this.summaryVisible = false;
	}

	start(name, total) {
		this.clearSummary();
		const totalLabel = total == null ? "?" : fmtNum(total);
		console.log(`▶ ${name}  (${totalLabel} docs)`);
		this.active.set(name, { done: 0, total, t0: Date.now() });
		this.draw(true);
	}

	tick(name, n = 1) {
		const st = this.active.get(name);
		if (st) st.done += n;
		this.totalDone += n;
		stats.docs += n;
		this.draw(false);
	}

	finish(name) {
		const st = this.active.get(name);
		this.clearSummary();
		const done = st?.done || 0;
		const elapsed = st ? Date.now() - st.t0 : 0;
		console.log(`✓ ${name}  ${fmtNum(done)} docs in ${fmtDuration(elapsed)}  (${fmtNum(rate(done, elapsed))}/s)`);
		this.active.delete(name);
		this.draw(true);
	}

	error(name, message) {
		this.clearSummary();
		console.error(`✗ ${name}: ${message}`);
		this.draw(true);
	}

	skip(name, detail) {
		this.clearSummary();
		console.log(`⏭️  ${name}  ${detail}`);
		this.draw(true);
	}

	recreate(name, detail) {
		this.clearSummary();
		console.log(`♻️  ${name}  ${detail}`);
		this.draw(true);
	}

	draw(force) {
		const now = Date.now();
		if (!force && now - this.lastDraw < 120) return;
		this.lastDraw = now;
		const elapsed = now - startedAt;
		const r = rate(this.totalDone, elapsed);
		const parts = [];
		for (const [name, st] of this.active) {
			if (st.total != null && st.total > 0) {
				parts.push(`${shortName(name)} ${((100 * st.done) / st.total).toFixed(0)}%`);
			} else {
				parts.push(`${shortName(name)} ${fmtNum(st.done)}`);
			}
		}
		const active = parts.length ? parts.join(" · ") : "idle";
		const line =
			`  ⟳ workers ${this.active.size}/${CONCURRENCY}  [${active}]` +
			`  ‖  total ${fmtNum(this.totalDone)}  ${fmtNum(r)}/s  ${fmtDuration(elapsed)}`;
		process.stdout.write(`\r${line.padEnd(160)}`);
		this.summaryVisible = true;
	}

	clearSummary() {
		if (!this.summaryVisible) return;
		process.stdout.write("\n");
		this.summaryVisible = false;
	}
}

const progress = new ProgressHub();

async function countCollection(colRef) {
	try {
		const agg = await colRef.count().get();
		return agg.data().count;
	} catch {
		return null;
	}
}

async function countMongoCollection(mongoDb, name) {
	try {
		const cols = await mongoDb.listCollections({ name }, { nameOnly: true }).toArray();
		if (!cols.length) return { exists: false, count: 0 };
		// Exact count only — no document body scan.
		const count = await mongoDb.collection(name).countDocuments();
		return { exists: true, count };
	} catch {
		return { exists: false, count: 0 };
	}
}

async function readPage(colRef, afterDoc) {
	let query = colRef.orderBy("__name__").limit(PAGE_SIZE);
	if (afterDoc) query = query.startAfter(afterDoc);
	return query.get();
}

async function upsertChunk(mongoCol, chunk) {
	const ops = chunk.map((doc) => ({
		replaceOne: {
			filter: { _id: doc._id },
			replacement: doc,
			upsert: true,
		},
	}));
	try {
		await mongoCol.bulkWrite(ops, { ordered: false });
		for (const doc of chunk) stats.bytesApprox += approxSize(doc);
		return chunk.length;
	} catch {
		let ok = 0;
		for (const doc of chunk) {
			try {
				await mongoCol.replaceOne({ _id: doc._id }, doc, { upsert: true });
				stats.bytesApprox += approxSize(doc);
				ok += 1;
			} catch (docErr) {
				stats.errors += 1;
				progress.clearSummary();
				console.error(`  ! failed ${doc._firestorePath}: ${docErr.message}`);
			}
		}
		return ok;
	}
}

/** @returns {Promise<number>} docs successfully written */
async function flushChunk(mongoCol, chunk, useInsert) {
	if (!chunk.length) return 0;

	if (DRY_RUN) {
		for (const doc of chunk) stats.bytesApprox += approxSize(doc);
		return chunk.length;
	}

	if (useInsert) {
		try {
			await mongoCol.insertMany(chunk, { ordered: false });
			for (const doc of chunk) stats.bytesApprox += approxSize(doc);
			return chunk.length;
		} catch (err) {
			const failedIndexes = new Set(
				(err?.writeErrors || []).map((e) => e.index).filter((i) => Number.isInteger(i)),
			);
			const insertedIds = err?.insertedIds || err?.result?.insertedIds || {};
			const insertedIndexes = new Set(
				Object.keys(insertedIds)
					.map(Number)
					.filter((i) => Number.isInteger(i)),
			);

			if (insertedIndexes.size) {
				for (const i of insertedIndexes) stats.bytesApprox += approxSize(chunk[i]);
			}

			const retry = chunk.filter((_, i) => failedIndexes.has(i) || !insertedIndexes.has(i));
			// If driver didn't expose indexes, retry the whole chunk via upsert.
			const toRetry = failedIndexes.size || insertedIndexes.size ? retry : chunk;
			if (!toRetry.length) return insertedIndexes.size;

			stats.errors += failedIndexes.size || Math.max(0, toRetry.length);
			const recovered = await upsertChunk(mongoCol, toRetry);
			return insertedIndexes.size + recovered;
		}
	}

	return upsertChunk(mongoCol, chunk);
}

/** Write docs in BATCH_SIZE chunks with limited parallel in-flight writes. */
async function writeDocs(mongoCol, docs, useInsert, collectionName) {
	const chunks = [];
	for (let i = 0; i < docs.length; i += BATCH_SIZE) {
		chunks.push(docs.slice(i, i + BATCH_SIZE));
	}
	if (!chunks.length) return;

	let cursor = 0;
	const inFlight = new Set();

	async function launch(chunk) {
		const p = flushChunk(mongoCol, chunk, useInsert)
			.then((written) => {
				progress.tick(collectionName, written);
			})
			.finally(() => inFlight.delete(p));
		inFlight.add(p);
		return p;
	}

	while (cursor < chunks.length || inFlight.size) {
		while (cursor < chunks.length && inFlight.size < WRITE_CONCURRENCY) {
			await launch(chunks[cursor++]);
		}
		if (inFlight.size) await Promise.race(inFlight);
	}
}

async function discoverSubcollections(docs) {
	const found = [];
	const CONC = 20;
	let i = 0;
	async function worker() {
		while (i < docs.length) {
			const doc = docs[i++];
			const subs = await doc.ref.listCollections();
			for (const sub of subs) found.push(sub);
		}
	}
	await Promise.all(Array.from({ length: Math.min(CONC, docs.length) }, () => worker()));
	return found;
}

async function copyCollection(colRef, mongoDb, enqueue) {
	const firestorePath = colRef.path;
	const mongoName = mongoCollectionName(firestorePath);

	if (ONLY && !firestorePath.includes("/") && !ONLY.has(colRef.id)) {
		stats.skippedCollections += 1;
		return;
	}

	const [fsCount, mongoInfo] = await Promise.all([
		countCollection(colRef),
		countMongoCollection(mongoDb, mongoName),
	]);

	// Resume: skip only when counts are known and equal (unless --drop).
	if (!DROP && fsCount != null && mongoInfo.exists && mongoInfo.count === fsCount) {
		stats.skippedMatched += 1;
		progress.skip(
			firestorePath,
			`skip — counts match (${fmtNum(fsCount)} docs)`,
		);
		return;
	}

	let reason;
	if (DROP) reason = "forced --drop";
	else if (!mongoInfo.exists) reason = "missing in Mongo";
	else if (fsCount == null) reason = `Mongo has ${fmtNum(mongoInfo.count)}, Firestore count unknown — recreating`;
	else reason = `count mismatch Firestore=${fmtNum(fsCount)} Mongo=${fmtNum(mongoInfo.count)} — recreating`;

	progress.recreate(firestorePath, reason);
	stats.recreated += 1;

	progress.start(firestorePath, fsCount);
	stats.collections += 1;

	const mongoCol = mongoDb.collection(mongoName);
	const useInsert = !DRY_RUN; // always recreate then insertMany on resume/mismatch

	if (!DRY_RUN) {
		await mongoCol.drop().catch((err) => {
			if (err?.codeName !== "NamespaceNotFound" && err?.code !== 26) throw err;
		});
	}

	let afterDoc = null;
	let prefetch = readPage(colRef, null);

	try {
		for (;;) {
			const snap = await prefetch;
			if (snap.empty) break;

			afterDoc = snap.docs[snap.docs.length - 1];
			const hasMore = snap.size === PAGE_SIZE;
			// Prefetch next Firestore page while we convert + write this one.
			prefetch = hasMore ? readPage(colRef, afterDoc) : null;

			const mongoDocs = snap.docs.map(docToMongo);
			const writePromise = writeDocs(mongoCol, mongoDocs, useInsert, firestorePath);

			if (DEEP) {
				const [subs] = await Promise.all([discoverSubcollections(snap.docs), writePromise]);
				for (const sub of subs) enqueue(sub);
			} else {
				await writePromise;
			}

			if (!hasMore) break;
		}
		progress.finish(firestorePath);
	} catch (err) {
		stats.errors += 1;
		progress.error(firestorePath, err?.message || String(err));
		throw err;
	}
}

/** Dynamic work queue with N parallel workers (supports --deep enqueue). */
function createWorkPool(concurrency) {
	const queue = [];
	const seen = new Set();
	let running = 0;
	const waiters = [];

	function signalAll() {
		while (waiters.length) waiters.shift()();
	}

	function enqueue(item) {
		if (!item?.path || seen.has(item.path)) return false;
		seen.add(item.path);
		queue.push(item);
		signalAll();
		return true;
	}

	async function run(workerFn) {
		const workers = Array.from({ length: concurrency }, async () => {
			for (;;) {
				while (!queue.length) {
					if (running === 0) {
						signalAll();
						return;
					}
					await new Promise((resolve) => {
						waiters.push(resolve);
					});
					if (!queue.length && running === 0) {
						signalAll();
						return;
					}
				}

				const item = queue.shift();
				running += 1;
				try {
					await workerFn(item);
				} finally {
					running -= 1;
					signalAll();
				}
			}
		});
		await Promise.all(workers);
	}

	return { enqueue, run, seen };
}

async function main() {
	const mongoUrl = encodeMongoUrl(DEFAULT_MONGO_URL);
	const dbName = DEFAULT_DB;
	const meta = getFirebaseMeta();
	const writeMode = DRY_RUN
		? "DRY-RUN"
		: DROP
			? "FORCE DROP+insertMany (all)"
			: "RESUME (count-match skip · mismatch recreate)";

	console.log("══════════════════════════════════════════════════════════");
	console.log(" Firestore → MongoDB copy (high throughput)");
	console.log(` Firebase project : ${meta.projectId || "(from credentials)"}`);
	console.log(` MongoDB          : ${maskUrl(mongoUrl)}`);
	console.log(` Database         : ${dbName}`);
	console.log(` Page / batch     : ${PAGE_SIZE} / ${BATCH_SIZE}`);
	console.log(` Concurrency      : ${CONCURRENCY} collections · ${WRITE_CONCURRENCY} writes/collection`);
	console.log(` Mode             : ${writeMode}`);
	console.log(` Subcollections   : ${DEEP ? "YES (--deep)" : "skipped (pass --deep to include)"}`);
	if (ONLY) console.log(` Filter           : ${[...ONLY].join(", ")}`);
	console.log("══════════════════════════════════════════════════════════");

	const firestore = getFirestoreDb();
	const poolSize = Math.max(16, CONCURRENCY * 3);
	const client = new MongoClient(mongoUrl, {
		maxPoolSize: poolSize,
		minPoolSize: Math.min(4, poolSize),
		serverSelectionTimeoutMS: 20_000,
	});

	console.log("\nConnecting to MongoDB…");
	await client.connect();
	await client.db("admin").command({ ping: 1 }).catch(async () => {
		await client.db(dbName).command({ ping: 1 });
	});
	const mongoDb = client.db(dbName);
	console.log(`Connected. Writing into database "${dbName}".\n`);

	const rootCols = await firestore.listCollections();
	rootCols.sort((a, b) => a.id.localeCompare(b.id));

	const toCopy = ONLY ? rootCols.filter((c) => ONLY.has(c.id)) : rootCols;
	if (ONLY) stats.skippedCollections = rootCols.length - toCopy.length;

	console.log(
		`Discovered ${rootCols.length} root collections → checking/copying ${toCopy.length} with ${CONCURRENCY} workers.\n`,
	);

	const pool = createWorkPool(CONCURRENCY);
	for (const col of toCopy) pool.enqueue(col);

	let fatal = null;
	try {
		await pool.run(async (colRef) => {
			try {
				await copyCollection(colRef, mongoDb, pool.enqueue);
			} catch (err) {
				// Keep other workers going; record first fatal for exit code.
				fatal ||= err;
			}
		});
	} finally {
		progress.clearSummary();
		await client.close().catch(() => {});
	}

	const elapsed = Date.now() - startedAt;
	console.log("\n══════════════════════════════════════════════════════════");
	console.log(" Done");
	console.log(` Collections copied : ${fmtNum(stats.collections)}`);
	console.log(` Skipped (matched)  : ${fmtNum(stats.skippedMatched)}`);
	console.log(` Recreated          : ${fmtNum(stats.recreated)}`);
	console.log(` Documents written  : ${fmtNum(stats.docs)}`);
	console.log(` Approx payload     : ${(stats.bytesApprox / (1024 * 1024)).toFixed(1)} MB`);
	console.log(` Errors             : ${fmtNum(stats.errors)}`);
	console.log(` Skipped (filter)   : ${fmtNum(stats.skippedCollections)}`);
	console.log(` Elapsed            : ${fmtDuration(elapsed)}  (${fmtNum(rate(stats.docs, elapsed))} docs/s)`);
	console.log(` Target             : ${maskUrl(mongoUrl)} / ${dbName}`);
	console.log("══════════════════════════════════════════════════════════");

	if (fatal) {
		console.error("\nOne or more collections failed:", fatal.message || fatal);
		process.exitCode = 1;
	} else if (stats.errors) {
		process.exitCode = 1;
	}
}

main().catch((err) => {
	progress.clearSummary();
	console.error("\nCopy failed:", err?.stack || err);
	process.exit(1);
});

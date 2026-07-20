import { once } from "node:events";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { EJSON } from "bson";
import { ZipArchive } from "archiver";
import { getMongoDb } from "../db/mongo.js";

function stampFileName() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `AthensDB-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
}

async function writeWithBackpressure(pass, chunk) {
	if (!pass.write(chunk)) {
		await once(pass, "drain");
	}
}

/**
 * Append one collection as a streaming JSON array entry.
 * Backpressure keeps zip bytes flowing to the client while we read Mongo.
 */
async function appendCollectionJson(archive, collection, fileName) {
	const pass = new PassThrough({ highWaterMark: 512 * 1024 });
	archive.append(pass, { name: fileName });

	let first = true;
	const cursor = collection.find({}).batchSize(200);
	try {
		await writeWithBackpressure(pass, "[\n");
		for await (const doc of cursor) {
			const chunk = `${first ? "" : ",\n"}${EJSON.stringify(doc, { relaxed: false })}`;
			first = false;
			await writeWithBackpressure(pass, chunk);
		}
		await writeWithBackpressure(pass, "\n]\n");
	} finally {
		await cursor.close().catch(() => {});
	}

	pass.end();
	// Only wait for the writable side — archiver owns the readable consumer.
	await finished(pass, { readable: false });
}

/**
 * Stream a zip of every collection in AthensDB as `<name>.json`.
 * Headers are flushed immediately so Vite/browsers do not idle-timeout.
 * @param {import("express").Response} res
 */
export async function streamFullMongoBackupZip(res) {
	const db = getMongoDb();
	if (!db) {
		const err = new Error("Database not ready");
		err.status = 503;
		throw err;
	}

	const collections = await db.listCollections({}, { nameOnly: true }).toArray();
	const names = collections
		.map((c) => c.name)
		.filter((name) => name && !name.startsWith("system."))
		.sort((a, b) => a.localeCompare(b));

	const fileName = stampFileName();
	const manifest = {
		database: db.databaseName,
		exportedAt: new Date().toISOString(),
		collections: [],
	};

	// Send response headers before any collection work so the proxy stays alive.
	res.setHeader("Content-Type", "application/zip");
	res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Accel-Buffering", "no");
	if (typeof res.flushHeaders === "function") {
		res.flushHeaders();
	}

	const archive = new ZipArchive({
		zlib: { level: 6 },
		highWaterMark: 1024 * 1024,
	});

	let archiveError = null;
	archive.on("error", (err) => {
		archiveError = err;
		console.error("[mongo-backup] archive error", err);
		if (!res.destroyed) res.destroy(err);
	});

	archive.pipe(res);

	for (const name of names) {
		if (archiveError) throw archiveError;
		const collection = db.collection(name);
		const count = await collection.estimatedDocumentCount();
		manifest.collections.push({ name, count });
		await appendCollectionJson(archive, collection, `${name}.json`);
	}

	archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "_manifest.json" });
	await archive.finalize();
	if (archiveError) throw archiveError;

	return { fileName, collectionCount: names.length };
}

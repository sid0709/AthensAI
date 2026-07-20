import fs from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EJSON } from "bson";
import { getMongoDb } from "../db/mongo.js";

const require = createRequire(import.meta.url);
const archiver = require("archiver");

function stampFileName() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `AthensDB-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
}

/**
 * Write one collection as a JSON array file (MongoDB EJSON, restore-friendly).
 */
async function writeCollectionJson(collection, filePath) {
	const out = fs.createWriteStream(filePath, { encoding: "utf8" });
	out.write("[\n");
	let first = true;
	const cursor = collection.find({}).batchSize(200);
	try {
		for await (const doc of cursor) {
			const chunk = `${first ? "" : ",\n"}${EJSON.stringify(doc, { relaxed: false })}`;
			first = false;
			if (!out.write(chunk)) {
				await new Promise((resolve) => out.once("drain", resolve));
			}
		}
	} finally {
		await cursor.close().catch(() => {});
	}
	out.write("\n]\n");
	await new Promise((resolve, reject) => {
		out.end(() => resolve());
		out.on("error", reject);
	});
}

/**
 * Stream a zip of every collection in AthensDB as `<name>.json`.
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

	const tmpDir = await mkdtemp(path.join(os.tmpdir(), "athens-mongo-backup-"));
	const fileName = stampFileName();
	const manifest = {
		database: db.databaseName,
		exportedAt: new Date().toISOString(),
		collections: [],
	};

	try {
		for (const name of names) {
			const collection = db.collection(name);
			const count = await collection.countDocuments();
			manifest.collections.push({ name, count });
			await writeCollectionJson(collection, path.join(tmpDir, `${name}.json`));
		}
		await writeFile(path.join(tmpDir, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		res.setHeader("Content-Type", "application/zip");
		res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
		res.setHeader("Cache-Control", "no-store");

		const archive = archiver("zip", { zlib: { level: 9 } });
		const done = new Promise((resolve, reject) => {
			archive.on("error", reject);
			archive.on("end", resolve);
		});
		archive.pipe(res);
		archive.directory(tmpDir, false);
		await archive.finalize();
		await done;

		return { fileName, collectionCount: names.length };
	} finally {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

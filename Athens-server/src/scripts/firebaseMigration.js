#!/usr/bin/env node
import "dotenv/config";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { BSON, GridFSBucket, MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import { getFirebaseAuth, getFirestoreDb, getStorageBucket } from "../services/firebase/firebaseAdmin.js";
import { rewrapProfileSecretsWithKms } from "../services/autoBidProfileSecrets.js";
import { firestoreUniqueReservations } from "../db/firestoreMongoAdapter.js";

const mode = process.argv[2] || "audit";
const sourceUrl = process.env.MONGO_SOURCE_URL || process.env.MONGO_URL;
const sourceDbName = process.env.MONGO_SOURCE_DB || process.env.MONGO_DB || "AthensDB";
const outputDir = path.resolve(process.env.MIGRATION_OUTPUT_DIR || "migration-output");
const MAX_FIRESTORE_BYTES = 900 * 1024;
const TRANSFORMATION_VERSION = 2;
const GRIDFS = { user_resumes: "user_resume_files", resume_templates: "resume_template_files" };
const JOB_COLLECTIONS = new Set(["job_market", "external_scraped_jobs"]);
const BUSINESS_KEYS = {
	account_info: [["name"]],
	personal_info: [["name"]],
	mail_messages: [["applierName", "mailbox", "uid"]],
	mail_sync_state: [["applierName"]],
	mail_user_labels: [["applierName"]],
	resume_generator_config: [["applierName"]],
	rules: [["name"]],
	vendor_tasks: [["applierName", "jobId"], ["applierName", "applyUrl"]],
	job_match_scores: [["applierName", "jobId"]],
	match_profile_state: [["applierName"]],
	user_skills: [["applierName", "nameCanonical"]],
	skill_dictionary: [["nameCanonical"]],
	skill_enrichment_queue: [["normalizedKey"]],
	skill_cooccurrence: [["pairKey"]],
	user_knowledge_graphs: [["applierName", "resumeId"]],
	avalon_apply_runs: [["runId"]],
	monitor_current_status: [["component"]],
	monitor_daily_rollups: [["date", "component"]],
	job_market: [["jobID"], ["applyLink"]],
	external_scraped_jobs: [["jobID"], ["jobLink"]],
};

if (!sourceUrl) throw new Error("MONGO_SOURCE_URL (or MONGO_URL) is required");

function scalar(value) {
	if (value instanceof ObjectId) return value.toHexString();
	if (value instanceof Date) return value;
	if (Buffer.isBuffer(value)) return value;
	if (value?._bsontype === "Decimal128") return value.toString();
	if (value?._bsontype === "Long") return value.toBigInt() <= BigInt(Number.MAX_SAFE_INTEGER) ? value.toNumber() : value.toString();
	if (value?._bsontype === "Binary") return Buffer.from(value.buffer);
	if (value instanceof RegExp) return { pattern: value.source, options: value.flags };
	if (Array.isArray(value)) return value.map(scalar);
	if (value && typeof value === "object") {
		const out = {};
		for (const [key, child] of Object.entries(value)) if (child !== undefined) out[key] = scalar(child);
		return out;
	}
	return value;
}

function canonical(value) {
	if (value instanceof Date) return { $date: value.toISOString() };
	if (value?.toDate instanceof Function) return { $date: value.toDate().toISOString() };
	if (Buffer.isBuffer(value)) return { $binarySha256: sha(value), byteCount: value.length };
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
	return value;
}

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function documentHash(value) { return sha(JSON.stringify(canonical(value))); }
function firestoreSize(value) { return Buffer.byteLength(JSON.stringify(canonical(value))); }
function safeField(field) { return String(field).replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/\./g, "/"); }

function inspectSourceValue(value, pathName, result) {
	if (Buffer.isBuffer(value)) {
		result.bsonTypes.add("Buffer");
		result.binaryFields += 1;
		return;
	}
	if (value instanceof Date) {
		result.bsonTypes.add("Date");
		return;
	}
	if (value?._bsontype) result.bsonTypes.add(value._bsontype);
	if (typeof value === "string" && value.length > 0 && INLINE_BINARY.test(pathName)) result.binaryFields += 1;
	if (Array.isArray(value)) value.forEach((child, index) => inspectSourceValue(child, `${pathName}.${index}`, result));
	else if (value && typeof value === "object" && !value._bsontype) {
		for (const [key, child] of Object.entries(value)) inspectSourceValue(child, pathName ? `${pathName}.${key}` : key, result);
	}
}

async function streamToBuffer(stream) {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return Buffer.concat(chunks);
}

async function hashStorageObject(file) {
	const hash = createHash("sha256");
	let byteCount = 0;
	for await (const chunk of file.createReadStream()) {
		byteCount += chunk.length;
		hash.update(chunk);
	}
	return { sha256: hash.digest("hex"), byteCount };
}

async function writeObject({ collection, id, field, bytes, mimeType = "application/octet-stream" }) {
	const digest = sha(bytes);
	const objectPath = `migration/${collection}/${id}/${safeField(field)}-${digest.slice(0, 16)}`;
	const file = getStorageBucket().file(objectPath);
	const [exists] = await file.exists();
	if (exists) {
		const [metadata] = await file.getMetadata();
		if (metadata.metadata?.sha256 !== digest || Number(metadata.size) !== bytes.length) {
			throw new Error(`Deterministic object collision at ${objectPath}`);
		}
	} else {
		await file.save(bytes, {
			resumable: bytes.length > 5 * 1024 * 1024,
			validation: "crc32c",
			contentType: mimeType,
			metadata: { metadata: { sha256: digest, sourceCollection: collection, sourceId: id, sourceField: field } },
		});
	}
	const [metadata] = await file.getMetadata();
	return { storagePath: objectPath, generation: String(metadata.generation || ""), mimeType, byteCount: bytes.length, sha256: digest };
}

async function extractGridFs(db, collection, id, doc) {
	const bucketName = GRIDFS[collection];
	if (!bucketName || !doc.gridFsId) return null;
	const gridId = doc.gridFsId instanceof ObjectId ? doc.gridFsId : new ObjectId(String(doc.gridFsId));
	const filesDoc = await db.collection(`${bucketName}.files`).findOne({ _id: gridId });
	if (!filesDoc) throw new Error(`${bucketName} file ${gridId} is missing`);
	const bytes = await streamToBuffer(new GridFSBucket(db, { bucketName }).openDownloadStream(gridId));
	return writeObject({ collection, id, field: "gridfs", bytes, mimeType: filesDoc.contentType || filesDoc.metadata?.contentType || doc.mimeType });
}

const INLINE_BINARY = /(^|\.)(contentBase64|videoBase64|fileBase64|pdfBase64|dataBase64|binary|buffer)$/i;

function decodeInlineBinary(value, field) {
	if (Buffer.isBuffer(value)) return { bytes: value, mimeType: "application/octet-stream" };
	const dataUri = /^data:([^;,]+);base64,(.*)$/is.exec(String(value));
	const encoded = (dataUri?.[2] || String(value)).replace(/\s+/g, "");
	if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error(`Invalid base64 in ${field}`);
	const mimeType = dataUri?.[1] || (/videoBase64/i.test(field) ? "video/webm" : /pdfBase64/i.test(field) ? "application/pdf" : "application/octet-stream");
	return { bytes: Buffer.from(encoded, "base64"), mimeType };
}

async function extractInline(collection, id, value, prefix = "", objects = []) {
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i += 1) value[i] = await extractInline(collection, id, value[i], `${prefix}.${i}`, objects);
		return value;
	}
	if (!value || typeof value !== "object") return value;
	for (const [key, child] of Object.entries(value)) {
		const field = prefix ? `${prefix}.${key}` : key;
		if ((Buffer.isBuffer(child) && child.length) || (typeof child === "string" && child.length > 0 && INLINE_BINARY.test(field))) {
			const { bytes, mimeType } = decodeInlineBinary(child, field);
			const object = await writeObject({ collection, id, field, bytes, mimeType });
			objects.push(object);
			value[key] = { object };
		} else value[key] = await extractInline(collection, id, child, field, objects);
	}
	return value;
}

async function offloadOversizedStrings(collection, id, doc, objects) {
	while (firestoreSize(doc) > MAX_FIRESTORE_BYTES) {
		const candidates = [];
		function visit(value, prefix = "") {
			if (!value || typeof value !== "object") return;
			for (const [key, child] of Object.entries(value)) {
				const field = prefix ? `${prefix}.${key}` : key;
				if (typeof child === "string" && child.length > 32_000) candidates.push({ parent: value, key, field, bytes: Buffer.from(child) });
				else visit(child, field);
			}
		}
		visit(doc);
		candidates.sort((a, b) => b.bytes.length - a.bytes.length);
		const candidate = candidates[0];
		if (!candidate) throw new Error(`${collection}/${id} remains ${firestoreSize(doc)} bytes and has no offloadable string`);
		const object = await writeObject({ collection, id, field: candidate.field, bytes: candidate.bytes, mimeType: "text/plain; charset=utf-8" });
		objects.push(object);
		candidate.parent[candidate.key] = { object, encoding: "utf8" };
	}
}

async function transformDocument(db, sourceCollection, source, profileIds = new Map()) {
	const sourceId = String(source._id);
	const destinationCollection = JOB_COLLECTIONS.has(sourceCollection) ? "jobs" : sourceCollection;
	let doc = scalar(source);
	doc._id = sourceId;
	if (sourceCollection === "job_market") doc.sourceCatalog = "market";
	if (sourceCollection === "external_scraped_jobs") doc.sourceCatalog = "external";
	const profileName = String(
		doc.applierName ||
		doc.ownerName ||
		doc.profileName ||
		(["account_info", "personal_info"].includes(sourceCollection) ? doc.name : ""),
	).trim().toLowerCase();
	const profileId = profileIds.get(profileName) || (doc.profileId ? String(doc.profileId) : "");
	if (profileId) {
		doc.profileId ||= profileId;
		doc.ownerUid ||= `owner_${sha(profileId).slice(0, 32)}`;
	}
	if (sourceCollection === "account_info") {
		delete doc.password;
		delete doc.vendorPassword;
		if (doc.autoBidProfile) doc.autoBidProfile = await rewrapProfileSecretsWithKms(doc.autoBidProfile);
	}
	const objects = [];
	const gridObject = await extractGridFs(db, sourceCollection, sourceId, source);
	if (gridObject) {
		objects.push(gridObject);
		doc.file = gridObject;
		delete doc.gridFsId;
		delete doc.storage;
	}
	doc = await extractInline(sourceCollection, sourceId, doc, "", objects);
	await offloadOversizedStrings(sourceCollection, sourceId, doc, objects);
	if ((sourceCollection === "user_resumes" || sourceCollection === "resume_templates") && doc.contentBase64?.object) {
		doc.file = doc.contentBase64.object;
		doc.storage = "gcs";
		delete doc.contentBase64;
	}
	return { sourceCollection, sourceId, destinationCollection, destinationId: sourceId, doc, objects };
}

async function writeDestinationWithReservations(firestore, { sourceCollection, destinationCollection, destinationId, data }) {
	const reservations = firestoreUniqueReservations(sourceCollection, data, destinationId);
	await firestore.runTransaction(async (transaction) => {
		const snapshots = new Map();
		for (const reservation of reservations) {
			const ref = firestore.collection("unique_reservations").doc(reservation.id);
			snapshots.set(reservation.id, await transaction.get(ref));
		}
		for (const reservation of reservations) {
			const existing = snapshots.get(reservation.id);
			if (existing.exists && String(existing.data()?.targetId || "") !== String(destinationId)) {
				throw new Error(`Unique-key reservation ${reservation.id} already points to ${existing.data()?.targetId}`);
			}
		}
		transaction.set(firestore.collection(destinationCollection).doc(destinationId), data, { merge: false });
		for (const reservation of reservations) {
			transaction.set(firestore.collection("unique_reservations").doc(reservation.id), {
				collection: reservation.collection,
				keys: reservation.keys,
				values: reservation.values.map(String),
				targetId: String(destinationId),
				updatedAt: new Date(),
			}, { merge: true });
		}
	});
	return reservations.map((reservation) => reservation.id);
}

async function audit(db) {
	const collections = (await db.listCollections().toArray()).filter(({ name }) => !name.endsWith(".chunks") && !name.endsWith(".files"));
	const report = { database: sourceDbName, collectionCount: collections.length, collections: [], gridFs: [], storage: null, blockers: [] };
	for (const { name } of collections) {
		let count = 0, maxBsonBytes = 0, oversized = 0, binaryFields = 0;
		const bsonTypes = new Set();
		const uniqueMaps = (BUSINESS_KEYS[name] || []).map((fields) => ({ fields, values: new Map() }));
		for await (const doc of db.collection(name).find({})) {
			count += 1;
			const bytes = BSON.calculateObjectSize(doc);
			maxBsonBytes = Math.max(maxBsonBytes, bytes);
			if (bytes > MAX_FIRESTORE_BYTES) oversized += 1;
			const inspected = { bsonTypes, binaryFields: 0 };
			inspectSourceValue(doc, "", inspected);
			binaryFields += inspected.binaryFields;
			for (const entry of uniqueMaps) {
				const values = entry.fields.map((field) => doc[field]);
				if (values.some((value) => value == null || value === "")) continue;
				const key = values.map(String).join("\0");
				const ids = entry.values.get(key) || [];
				ids.push(String(doc._id));
				entry.values.set(key, ids);
			}
		}
		const duplicateBusinessKeys = uniqueMaps.flatMap((entry) => [...entry.values.entries()]
			.filter(([, ids]) => ids.length > 1)
			.map(([value, ids]) => ({ fields: entry.fields, value: value.split("\0"), ids })));
		// job_market intentionally permits recurring/re-posted apply links; report
		// those duplicates for reconciliation without treating a non-unique legacy
		// business key as a cutover blocker.
		if (duplicateBusinessKeys.length && name !== "job_market") report.blockers.push({ collection: name, reason: "duplicate_business_keys", duplicateBusinessKeys });
		report.collections.push({ name, count, maxBsonBytes, oversized, binaryFields, bsonTypes: [...bsonTypes].sort(), duplicateBusinessKeys });
	}
	for (const bucket of Object.values(GRIDFS)) {
		const files = db.collection(`${bucket}.files`);
		report.gridFs.push({ bucket, files: await files.countDocuments(), bytes: (await files.aggregate([{ $group: { _id: null, bytes: { $sum: "$length" } } }]).toArray())[0]?.bytes || 0 });
	}
	const accounts = await db.collection("account_info").find({}).toArray();
	const personal = await db.collection("personal_info").find({}).toArray();
	const personalByName = new Map(personal.map((doc) => [String(doc.name || "").trim().toLowerCase(), doc]));
	const emailOwners = new Map();
	for (const account of accounts) {
		const profile = account.autoBidProfile || personalByName.get(String(account.name || "").trim().toLowerCase()) || {};
		const email = String(profile.email || account.email || "").trim().toLowerCase();
		if (!email) report.blockers.push({ collection: "account_info", sourceId: String(account._id), account: account.name, reason: "missing_email" });
		else emailOwners.set(email, [...(emailOwners.get(email) || []), String(account._id)]);
	}
	for (const [email, ids] of emailOwners) if (ids.length > 1) report.blockers.push({ collection: "account_info", email, ids, reason: "duplicate_email" });
	try {
		const [files] = await getStorageBucket().getFiles();
		report.storage = {
			bucket: getStorageBucket().name,
			objects: files.length,
			bytes: files.reduce((sum, file) => sum + Number(file.metadata?.size || 0), 0),
			objectsMissingSha256: files.filter((file) => !file.metadata?.metadata?.sha256).length,
		};
	} catch (error) {
		report.storage = { error: error.message };
	}
	await mkdir(outputDir, { recursive: true });
	await writeFile(path.join(outputDir, "audit.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
}

async function migrate(db) {
	const firestore = getFirestoreDb();
	const manifestPath = path.join(outputDir, "manifest.jsonl");
	await mkdir(outputDir, { recursive: true });
	await writeFile(manifestPath, "");
	const collections = (await db.listCollections().toArray()).filter(({ name }) => !name.endsWith(".chunks") && !name.endsWith(".files") && name !== "migration_manifest");
	const accounts = await db.collection("account_info").find({}, { projection: { _id: 1, name: 1 } }).toArray();
	const profileIds = new Map(accounts.map((account) => [String(account.name || "").trim().toLowerCase(), String(account._id)]));
	let migrated = 0;
	const destinations = new Set();
	for (const { name } of collections) {
		for await (const source of db.collection(name).find({})) {
			const sourceId = String(source._id);
			const sourceCanonicalHash = documentHash(scalar(source));
			const manifestId = sha(`${name}\0${sourceId}`);
			const previousManifest = await firestore.collection("migration_manifest").doc(manifestId).get();
			if (previousManifest.exists) {
				const previous = previousManifest.data();
				const existing = await firestore.collection(previous.destinationCollection).doc(previous.destinationId).get();
				if (
					previous.transformationVersion === TRANSFORMATION_VERSION &&
					previous.sourceCanonicalHash === sourceCanonicalHash &&
					existing.exists &&
					documentHash(existing.data()) === previous.canonicalHash
				) {
					const destinationKey = `${previous.destinationCollection}/${previous.destinationId}`;
					if (destinations.has(destinationKey)) throw new Error(`Two source documents map to ${destinationKey}; resolve the canonical job collision before cutover`);
					destinations.add(destinationKey);
					const uniqueReservations = await writeDestinationWithReservations(firestore, {
						sourceCollection: previous.sourceCollection,
						destinationCollection: previous.destinationCollection,
						destinationId: previous.destinationId,
						data: existing.data(),
					});
					const reused = { ...previous, uniqueReservations };
					await firestore.collection("migration_manifest").doc(manifestId).set(reused, { merge: false });
					await appendFile(manifestPath, `${JSON.stringify(reused)}\n`);
					migrated += 1;
					continue;
				}
			}
			const item = await transformDocument(db, name, source, profileIds);
			const destinationKey = `${item.destinationCollection}/${item.destinationId}`;
			if (destinations.has(destinationKey)) throw new Error(`Two source documents map to ${destinationKey}; resolve the canonical job collision before cutover`);
			destinations.add(destinationKey);
			const data = { ...item.doc }; delete data._id;
			const uniqueReservations = await writeDestinationWithReservations(firestore, {
				sourceCollection: name,
				destinationCollection: item.destinationCollection,
				destinationId: item.destinationId,
				data,
			});
			const entry = {
				sourceCollection: name, sourceId: item.sourceId,
				destinationCollection: item.destinationCollection, destinationId: item.destinationId,
				transformationVersion: TRANSFORMATION_VERSION,
				sourceCanonicalHash,
				byteCount: firestoreSize(data), canonicalHash: documentHash(data),
				objects: item.objects, uniqueReservations, migratedAt: new Date().toISOString(),
			};
			await firestore.collection("migration_manifest").doc(manifestId).set(entry, { merge: false });
			await appendFile(manifestPath, `${JSON.stringify(entry)}\n`);
			migrated += 1;
			if (migrated % 100 === 0) console.log(`Migrated ${migrated} documents`);
		}
	}
	console.log(`Migration complete: ${migrated} documents`);
}

async function findSourceById(db, collection, id) {
	if (/^[a-f0-9]{24}$/i.test(id)) {
		const byObjectId = await db.collection(collection).findOne({ _id: new ObjectId(id) });
		if (byObjectId) return byObjectId;
	}
	return db.collection(collection).findOne({ _id: id });
}

async function verify(db) {
	const firestore = getFirestoreDb();
	const manifests = await firestore.collection("migration_manifest").get();
	const failures = [];
	const expectedDestinations = new Map();
	const manifestSourceCounts = new Map();
	for (const manifestDoc of manifests.docs) {
		const manifest = manifestDoc.data();
		manifestSourceCounts.set(manifest.sourceCollection, (manifestSourceCounts.get(manifest.sourceCollection) || 0) + 1);
		expectedDestinations.set(manifest.destinationCollection, (expectedDestinations.get(manifest.destinationCollection) || 0) + 1);
		const source = await findSourceById(db, manifest.sourceCollection, manifest.sourceId);
		if (!source) failures.push({ ...manifest, error: "source_missing" });
		else if (manifest.sourceCanonicalHash && documentHash(scalar(source)) !== manifest.sourceCanonicalHash) failures.push({ ...manifest, error: "source_changed_since_migration" });
		const snap = await firestore.collection(manifest.destinationCollection).doc(manifest.destinationId).get();
		if (!snap.exists) { failures.push({ ...manifest, error: "destination_missing" }); continue; }
		if (firestoreSize(snap.data()) > MAX_FIRESTORE_BYTES) failures.push({ ...manifest, error: "destination_over_900_kib", actualBytes: firestoreSize(snap.data()) });
		const hash = documentHash(snap.data());
		if (hash !== manifest.canonicalHash) failures.push({ ...manifest, error: "document_hash_mismatch", actual: hash });
		const reservations = manifest.uniqueReservations || firestoreUniqueReservations(manifest.sourceCollection, snap.data(), manifest.destinationId).map((item) => item.id);
		for (const reservationId of reservations) {
			const reservation = await firestore.collection("unique_reservations").doc(reservationId).get();
			if (!reservation.exists || String(reservation.data()?.targetId || "") !== String(manifest.destinationId)) {
				failures.push({ ...manifest, error: "unique_reservation_mismatch", reservationId });
			}
		}
		for (const object of manifest.objects || []) {
			const file = getStorageBucket().file(object.storagePath);
			const [metadata] = await file.getMetadata().catch(() => [null]);
			if (!metadata) {
				failures.push({ ...manifest, error: "object_missing", object: object.storagePath });
				continue;
			}
			const actual = await hashStorageObject(file).catch(() => null);
			if (
				!actual ||
				actual.sha256 !== object.sha256 ||
				actual.byteCount !== object.byteCount ||
				metadata.metadata?.sha256 !== object.sha256 ||
				Number(metadata.size) !== object.byteCount
			) failures.push({ ...manifest, error: "object_mismatch", object: object.storagePath, actual });
		}
	}
	for (const [collection, expected] of manifestSourceCounts) {
		const actual = await db.collection(collection).countDocuments();
		if (actual !== expected) failures.push({ collection, error: "source_count_mismatch", expected, actual });
	}
	for (const [collection, expected] of expectedDestinations) {
		const actual = (await firestore.collection(collection).count().get()).data().count;
		if (actual !== expected) failures.push({ collection, error: "destination_count_mismatch", expected, actual });
	}
	const accounts = await db.collection("account_info").find({}).toArray();
	for (const account of accounts) {
		const uid = `owner_${sha(String(account._id)).slice(0, 32)}`;
		try { await getFirebaseAuth().getUser(uid); } catch { failures.push({ sourceCollection: "account_info", sourceId: String(account._id), error: "auth_user_missing", uid }); }
		const grant = await firestore.collection("profile_access").doc(sha(`${uid}\0${String(account._id)}`)).get();
		if (!grant.exists) failures.push({ sourceCollection: "account_info", sourceId: String(account._id), error: "owner_access_grant_missing", uid });
	}
	const vendorMap = process.env.MIGRATION_VENDOR_MAP ? JSON.parse(process.env.MIGRATION_VENDOR_MAP) : [];
	for (const vendor of vendorMap) {
		const email = String(vendor.email || "").trim().toLowerCase();
		try {
			const user = await getFirebaseAuth().getUserByEmail(email);
			if (String(user.customClaims?.role || "").toLowerCase() !== "bidder") failures.push({ email, error: "vendor_role_mismatch" });
			const grant = await firestore.collection("profile_access").doc(sha(`${user.uid}\0${vendor.profileId}`)).get();
			if (!grant.exists || String(grant.data()?.profileId || "") !== String(vendor.profileId)) failures.push({ email, profileId: vendor.profileId, error: "vendor_access_grant_missing" });
		} catch {
			failures.push({ email, profileId: vendor.profileId, error: "vendor_auth_user_missing" });
		}
	}
	const result = { manifests: manifests.size, failures };
	await writeFile(path.join(outputDir, "verify.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
	if (failures.length) process.exitCode = 2;
}

async function importAuth(db) {
	const accounts = await db.collection("account_info").find({}).toArray();
	const personal = await db.collection("personal_info").find({}).toArray();
	const personalByName = new Map(personal.map((doc) => [String(doc.name || "").toLowerCase(), doc]));
	const rows = accounts.map((account) => {
		const profile = account.autoBidProfile || personalByName.get(String(account.name || "").toLowerCase()) || {};
		return { account, email: String(profile.email || account.email || "").trim().toLowerCase() };
	});
	const counts = new Map();
	for (const row of rows) if (row.email) counts.set(row.email, (counts.get(row.email) || 0) + 1);
	const blockers = rows.flatMap(({ account, email }) => !email ? [{ account: account.name, reason: "missing_email" }] : counts.get(email) > 1 ? [{ account: account.name, email, reason: "duplicate_email" }] : []);
	if (blockers.length) {
		await writeFile(path.join(outputDir, "auth-blockers.json"), JSON.stringify(blockers, null, 2));
		console.error(JSON.stringify({ blockers }, null, 2)); process.exitCode = 2; return;
	}
	const auth = getFirebaseAuth();
	const firestore = getFirestoreDb();
	const resetRequired = [];
	for (const { account, email } of rows) {
		const uid = `owner_${sha(String(account._id)).slice(0, 32)}`;
		const importRecord = { uid, email, displayName: String(account.name || email), emailVerified: false };
		const bcryptHash = typeof account.password === "string" && /^\$2[aby]\$/.test(account.password);
		const defaultPassword = process.env.MIGRATION_LEGACY_DEFAULT_PASSWORD || "12345678";
		const usesDefaultPassword = bcryptHash ? await bcrypt.compare(defaultPassword, account.password) : true;
		if (bcryptHash && !usesDefaultPassword) importRecord.passwordHash = Buffer.from(account.password);
		let existing = null;
		try { existing = await auth.getUserByEmail(email); } catch (error) { if (error?.code !== "auth/user-not-found") throw error; }
		if (existing && existing.uid !== uid) throw new Error(`Auth email ${email} already belongs to unexpected UID ${existing.uid}`);
		if (!existing) {
			const result = await auth.importUsers([importRecord], importRecord.passwordHash ? { hash: { algorithm: "BCRYPT" } } : undefined);
			if (result.failureCount) throw result.errors[0].error;
		}
		if (!importRecord.passwordHash) resetRequired.push({
			uid,
			email,
			account: account.name,
			reason: usesDefaultPassword ? "legacy_default_password" : "missing_valid_bcrypt_hash",
			resetLink: await auth.generatePasswordResetLink(email),
		});
		const role = String(account.permission || "").trim().toLowerCase() === "admin" ? "admin" : "owner";
		await auth.setCustomUserClaims(uid, role === "admin" ? { role, admin: true } : { role });
		const profileId = String(account._id);
		await firestore.collection("profile_access").doc(sha(`${uid}\0${profileId}`)).set({ uid, profileId, profileName: account.name, role: "owner", primary: true, createdAt: new Date() });
	}
	const vendorMap = process.env.MIGRATION_VENDOR_MAP ? JSON.parse(process.env.MIGRATION_VENDOR_MAP) : [];
	const ownerEmails = new Set(rows.map((row) => row.email));
	const ownerProfileIds = new Set(accounts.map((account) => String(account._id)));
	const vendorEmails = new Set();
	for (const vendor of vendorMap) {
		const email = String(vendor.email || "").trim().toLowerCase();
		if (!email || !vendor.profileId) throw new Error("Each MIGRATION_VENDOR_MAP item needs email and profileId");
		if (ownerEmails.has(email)) throw new Error(`Vendor identity ${email} must be separate from every owner identity`);
		if (vendorEmails.has(email)) throw new Error(`Vendor identity ${email} appears more than once; use one explicit profile grant per bidder account`);
		if (!ownerProfileIds.has(String(vendor.profileId))) throw new Error(`Vendor identity ${email} references unknown profile ${vendor.profileId}`);
		vendorEmails.add(email);
		let user;
		try {
			user = await auth.getUserByEmail(email);
		} catch (error) {
			if (error?.code !== "auth/user-not-found") throw error;
			user = await auth.createUser({ email, displayName: vendor.displayName || email });
		}
		if (["owner", "admin"].includes(String(user.customClaims?.role || "").toLowerCase())) throw new Error(`Vendor identity ${email} is already an owner identity`);
		await auth.setCustomUserClaims(user.uid, { role: "bidder" });
		await firestore.collection("profile_access").doc(sha(`${user.uid}\0${vendor.profileId}`)).set({ uid: user.uid, profileId: String(vendor.profileId), profileName: vendor.profileName || "", role: "bidder", primary: vendor.primary !== false, createdAt: new Date() });
	}
	await writeFile(path.join(outputDir, "auth-reset-required.json"), JSON.stringify(resetRequired, null, 2), { mode: 0o600 });
	console.log(`Imported ${rows.length} owner identities and ${vendorMap.length} bidder identities; ${resetRequired.length} require password reset`);
}

const client = new MongoClient(sourceUrl);
try {
	await client.connect();
	const db = client.db(sourceDbName);
	if (mode === "audit") await audit(db);
	else if (mode === "migrate") await migrate(db);
	else if (mode === "verify") await verify(db);
	else if (mode === "auth") await importAuth(db);
	else throw new Error(`Unknown mode ${mode}; use audit, migrate, verify, or auth`);
} finally {
	await client.close();
}

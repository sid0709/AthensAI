#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getFirestoreDb, getStorageBucket } from "../services/firebase/firebaseAdmin.js";
import {
  buildStatusProjectionData,
  jobStatusProjectionId,
  stateOf,
  statesOf,
  statusContribution,
} from "../services/jobStatusProjectionService.js";
import { normalizeCanonicalJobStatuses } from "../services/canonicalJobStatus.js";
import { assertAuthoritativeAthensDb, DAVID_MOLL_ID, TEMP_ACCOUNT_ID } from "./firebaseResetSupport.js";
import { closeRedis, getRedis, initRedis, isRedisReady } from "../db/redis.js";
import {
  buildJobStatusCachePlan,
  replaceJobStatusCaches,
} from "../services/jobStatusCacheMaintenance.js";

const sourceUrl = process.env.MONGO_SOURCE_URL || "mongodb://127.0.0.1:27017";
const sourceDbName = process.env.MONGO_SOURCE_DB || "";
const mode = process.argv[2] || "all";
const MAX_BYTES = 900 * 1024;
const TEMP_PASSWORD_HASH = "$2b$12$ovyjFwBMmiISUyGuxMNADO5z3JX4goh3tkJXIPyzdSn6plYTXEBkO";
const JIMMY_SAMBUO_ID = "6a4db7709c4d5aeb05a71ad0";
const JOB_SOURCES = new Set(["job_market", "external_scraped_jobs"]);

function sha(value) { return createHash("sha256").update(value).digest("hex"); }

function scalar(value) {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (value?._bsontype === "Decimal128") return value.toString();
  if (value?._bsontype === "Long") return value.toBigInt() <= BigInt(Number.MAX_SAFE_INTEGER) ? value.toNumber() : value.toString();
  if (value?._bsontype === "Binary") return Buffer.from(value.buffer);
  if (Array.isArray(value)) return value.map(scalar);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) if (child !== undefined) out[key] = scalar(child);
    return out;
  }
  return value;
}

function documentBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, (_key, child) => Buffer.isBuffer(child) ? { bytes: child.length } : child));
}

async function externalizeLargeMailBody(doc, id) {
  if (documentBytes(doc) <= MAX_BYTES) return doc;
  const body = { bodyText: typeof doc.bodyText === "string" ? doc.bodyText : "", bodyHtml: typeof doc.bodyHtml === "string" ? doc.bodyHtml : null };
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  const digest = sha(bytes);
  const objectPath = `mail-bodies/${sha(`${doc.applierName || "unknown"}\0${doc.mailbox || ""}\0${doc.uid || id}`).slice(0, 32)}/body-${digest.slice(0, 16)}.json`;
  const file = getStorageBucket().file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    await file.save(bytes, {
      resumable: bytes.length >= 5 * 1024 * 1024,
      validation: "crc32c",
      metadata: { contentType: "application/json", cacheControl: "private, max-age=0, no-store", metadata: { sha256: digest, kind: "mail-body" } },
    });
  }
  const [metadata] = await file.getMetadata();
  return {
    ...doc,
    bodyText: body.bodyText.slice(0, 32 * 1024),
    bodyHtml: null,
    bodyExternalized: true,
    bodyObject: {
      storagePath: objectPath,
      generation: String(metadata.generation || ""),
      mimeType: "application/json",
      byteCount: bytes.length,
      sha256: digest,
    },
  };
}

function destinationName(source) { return JOB_SOURCES.has(source) ? "jobs" : source; }

function profileResolver(profileIds) {
  const known = new Set([...profileIds.values()].map(String));
  known.add(TEMP_ACCOUNT_ID);
  return (value) => {
    const raw = String(value?._bsontype === "ObjectId" ? value.toHexString() : value || "").trim();
    return known.has(raw) ? raw : profileIds.get(raw.toLowerCase()) || null;
  };
}

async function transform(sourceName, source, profileIds) {
  const id = String(source._id);
  const doc = scalar(source);
  delete doc._id;
  if (sourceName === "job_market") {
    doc.sourceCatalog = "market";
    doc.extensionV2 = String(doc.version || "") === "v2";
    const normalized = normalizeCanonicalJobStatuses(doc.status, profileResolver(profileIds));
    if (normalized.issues.length) throw new Error(`Job ${id} has invalid status data: ${JSON.stringify(normalized.issues)}`);
    doc.status = normalized.statuses;
    delete doc.statusProfileIds;
  } else if (sourceName === "external_scraped_jobs") {
    doc.sourceCatalog = "external";
  }
  const profileName = String(doc.applierName || doc.ownerName || doc.profileName || (["account_info", "personal_info"].includes(sourceName) ? doc.name : "")).trim().toLowerCase();
  if (profileIds.get(profileName)) doc.profileId ||= profileIds.get(profileName);
  const output = sourceName === "mail_messages" ? await externalizeLargeMailBody(doc, id) : doc;
  const bytes = documentBytes(output);
  if (bytes > MAX_BYTES) throw new Error(`${sourceName}/${id} is ${bytes} bytes after transformation`);
  return { id, doc: output };
}

async function writeDocuments(firestore, collectionName, rows) {
  const writer = firestore.bulkWriter();
  writer.onWriteError((error) => error.failedAttempts < 5);
  let written = 0;
  for (const row of rows) {
    writer.set(firestore.collection(collectionName).doc(row.id), row.doc, { merge: false });
    written += 1;
    if (written % 2000 === 0) {
      await writer.flush();
      console.log(`${collectionName}: ${written}`);
    }
  }
  await writer.close();
  return written;
}

async function copyAccounts(db, firestore) {
  const profileIds = new Map();
  const rows = [];
  for await (const source of db.collection("account_info").find({})) {
    profileIds.set(String(source.name || "").trim().toLowerCase(), String(source._id));
    rows.push(await transform("account_info", source, profileIds));
  }
  rows.push({ id: TEMP_ACCOUNT_ID, doc: {
    name: "temp", password: TEMP_PASSWORD_HASH, vendorAllowed: false,
    temporaryMigrationAccount: true, migrationStatusOwnerId: TEMP_ACCOUNT_ID,
    createdAt: new Date("2026-07-24T00:00:00.000Z"),
  } });
  await writeDocuments(firestore, "account_info", rows);
  const snapshot = await firestore.collection("account_info").get();
  if (snapshot.size !== 35) throw new Error(`Account checkpoint failed: expected 35, found ${snapshot.size}`);
  if (snapshot.docs.find((doc) => doc.id === DAVID_MOLL_ID)?.data()?.name !== "David Moll") throw new Error("David Moll account ID checkpoint failed");
  if (snapshot.docs.find((doc) => doc.id === TEMP_ACCOUNT_ID)?.data()?.name !== "temp") throw new Error("Temporary account checkpoint failed");
  console.log("Account checkpoint passed: 35 documents, David and temp IDs verified");
  return profileIds;
}

async function copyRemaining(db, firestore, profileIds) {
  const collections = (await db.listCollections().toArray())
    .map((row) => row.name)
    .filter((name) => !name.endsWith(".files") && !name.endsWith(".chunks") && name !== "account_info");
  const destinationCounts = new Map();
  for (const sourceName of collections) {
    const rows = [];
    for await (const source of db.collection(sourceName).find({})) {
      const row = await transform(sourceName, source, profileIds);
      rows.push(row);
    }
    const destination = destinationName(sourceName);
    await writeDocuments(firestore, destination, rows);
    destinationCounts.set(destination, (destinationCounts.get(destination) || 0) + rows.length);
    console.log(`${sourceName} -> ${destination}: ${rows.length}`);
  }
  return destinationCounts;
}

function emptyStatusCounts(profileId, totalJobs) {
  return {
    schemaVersion: 2, profileId, all: totalJobs, posted: totalJobs, any: 0, rawApplied: 0,
    applied: 0, scheduled: 0, declined: 0, "bid-ready": 0,
    "bid-completed": 0, other: 0, jobIdsByState: {},
  };
}

async function rebuildJobStatuses(db, firestore, totalJobs) {
  await Promise.all([
    firestore.recursiveDelete(firestore.collection("job_statuses")),
    firestore.recursiveDelete(firestore.collection("job_status_counts")),
  ]);

  const accounts = await db.collection("account_info").find({}, { projection: { _id: 1 } }).toArray();
  const knownProfileIds = new Set(accounts.map((account) => String(account._id)));
  knownProfileIds.add(TEMP_ACCOUNT_ID);
  const counts = new Map([...knownProfileIds].map((profileId) => [profileId, emptyStatusCounts(profileId, totalJobs)]));
  const rows = [];

  for await (const source of db.collection("job_market").find({}, { projection: { status: 1, postedAt: 1, createdAt: 1, version: 1, extensionV2: 1 } })) {
    const normalized = normalizeCanonicalJobStatuses(source.status, (value) => {
      const profileId = String(value?._bsontype === "ObjectId" ? value.toHexString() : value || "");
      return knownProfileIds.has(profileId) ? profileId : null;
    });
    if (normalized.issues.length) throw new Error(`Job ${source._id} has invalid status data: ${JSON.stringify(normalized.issues)}`);

	for (const statusRow of normalized.statuses) {
		const profileId = statusRow.applier;
		const statuses = [statusRow];
		const contribution = statusContribution(statusRow);
		const states = statesOf(statusRow);
		const row = counts.get(profileId);
      row.any += 1;
      for (const [field, value] of Object.entries(contribution)) row[field] += Number(value || 0);
      if (!states.length) row.other += 1;
		rows.push({
			id: jobStatusProjectionId(profileId, String(source._id)),
			doc: buildStatusProjectionData({
				profileId,
				jobId: String(source._id),
				job: {
					sourceCatalog: "market",
					postedAt: scalar(source.postedAt || source.createdAt || null),
					version: source.version || null,
					extensionV2: Boolean(source.extensionV2) || String(source.version || "") === "v2",
				},
				statuses,
			}),
		});
    }
  }

  for (const row of counts.values()) row.posted = Math.max(0, totalJobs - row.any);
  const timeOf = (value) => {
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
  };
  const orderedRows = [...rows].sort((left, right) => {
    const byTime = timeOf(right.doc.postedAt) - timeOf(left.doc.postedAt);
    return byTime || String(right.doc.jobId).localeCompare(String(left.doc.jobId));
  });
  for (const { doc } of orderedRows) {
    const profileCounts = counts.get(doc.profileId);
    for (const state of doc.states) {
      if (!profileCounts.jobIdsByState[state]) profileCounts.jobIdsByState[state] = [];
      profileCounts.jobIdsByState[state].push(doc.jobId);
    }
  }
  await writeDocuments(firestore, "job_statuses", rows);
  await writeDocuments(firestore, "job_status_counts", [...counts].map(([id, doc]) => ({ id, doc: { ...doc, updatedAt: new Date() } })));
  console.log(`Rebuilt ${rows.length} exact job/profile status projections for ${counts.size} accounts`);
  return { projections: rows.length, accounts: counts.size };
}

async function verify(firestore, expectedCounts) {
  for (const [collection, expected] of expectedCounts) {
    const actual = (await firestore.collection(collection).count().get()).data().count;
    if (actual !== expected) throw new Error(`${collection} count mismatch: expected ${expected}, found ${actual}`);
  }
  const david = (await firestore.collection("job_status_counts").doc(DAVID_MOLL_ID).get()).data();
  const expectedDavid = { all: 14813, posted: 13420, applied: 1382, scheduled: 8, "bid-completed": 3 };
  for (const [key, expected] of Object.entries(expectedDavid)) {
    if (Number(david?.[key]) !== expected) throw new Error(`David ${key} mismatch: expected ${expected}, found ${david?.[key]}`);
  }
  const jimmy = (await firestore.collection("job_status_counts").doc(JIMMY_SAMBUO_ID).get()).data();
  const expectedJimmy = { all: 14813, posted: 13111, applied: 1668, scheduled: 0, "bid-ready": 25, "bid-completed": 9 };
  for (const [key, expected] of Object.entries(expectedJimmy)) {
    if (Number(jimmy?.[key]) !== expected) throw new Error(`Jimmy ${key} mismatch: expected ${expected}, found ${jimmy?.[key]}`);
  }
  console.log("Verification passed", { counts: Object.fromEntries(expectedCounts), david: expectedDavid, jimmy: expectedJimmy });
}

async function rebuildDerivedJobStatusCaches(firestore) {
  const connected = await initRedis({ force: true });
  if (!connected || !isRedisReady()) {
    throw new Error("Redis is required to finish the job status restore safely");
  }
  try {
    const plan = await buildJobStatusCachePlan(firestore);
    if (plan.issues.length) {
      throw new Error(`Job status cache plan contains ${plan.issues.length} canonical issue(s)`);
    }
    const result = await replaceJobStatusCaches(getRedis(), plan);
    console.log("Job status Redis caches rebuilt", result);
    return result;
  } finally {
    await closeRedis();
  }
}

async function main() {
  if (!new Set(["accounts", "all", "statuses"]).has(mode)) throw new Error("Use: simpleAthensDbCopy.js accounts|all|statuses");
  const client = new MongoClient(sourceUrl);
  await client.connect();
  try {
    const db = client.db(sourceDbName);
    await assertAuthoritativeAthensDb(db, sourceDbName);
    const firestore = getFirestoreDb();
    const sourceAccounts = await db.collection("account_info").find({}, { projection: { _id: 1, name: 1 } }).toArray();
    const profileIds = new Map(sourceAccounts.map((row) => [String(row.name || "").trim().toLowerCase(), String(row._id)]));
    if (mode === "accounts") {
      await copyAccounts(db, firestore);
      return;
    }
    const accountCount = (await firestore.collection("account_info").count().get()).data().count;
    if (accountCount !== 35) throw new Error(`Run the account checkpoint first; expected 35 accounts, found ${accountCount}`);
    if (mode === "statuses") {
      const totalJobs = (await firestore.collection("jobs").count().get()).data().count;
      if (totalJobs !== 15835) throw new Error(`Status rebuild requires 15835 jobs, found ${totalJobs}`);
      const marketJobs = (await firestore.collection("jobs").where("sourceCatalog", "==", "market").count().get()).data().count;
      const rebuilt = await rebuildJobStatuses(db, firestore, marketJobs);
      await verify(firestore, new Map([["jobs", totalJobs], ["job_statuses", rebuilt.projections], ["job_status_counts", rebuilt.accounts]]));
      await rebuildDerivedJobStatusCaches(firestore);
      return;
    }
    const expected = await copyRemaining(db, firestore, profileIds);
    const marketJobs = await db.collection("job_market").countDocuments({});
    const rebuilt = await rebuildJobStatuses(db, firestore, marketJobs);
    expected.set("job_statuses", rebuilt.projections);
    expected.set("job_status_counts", rebuilt.accounts);
    expected.set("account_info", 35);
    await verify(firestore, expected);
    await rebuildDerivedJobStatusCaches(firestore);
  } finally {
    await client.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

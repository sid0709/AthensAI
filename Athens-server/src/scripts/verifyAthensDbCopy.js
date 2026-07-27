#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { getFirestoreDb } from "../services/firebase/firebaseAdmin.js";
import {
  jobStatusProjectionId,
  statusContribution,
} from "../services/jobStatusProjectionService.js";
import { createProfileIdResolver, normalizeCanonicalJobStatuses } from "../services/canonicalJobStatus.js";
import { assertAuthoritativeAthensDb, TEMP_ACCOUNT_ID } from "./firebaseResetSupport.js";

const sourceUrl = process.env.MONGO_SOURCE_URL || "mongodb://127.0.0.1:27017";
const sourceDbName = process.env.MONGO_SOURCE_DB || "";
const TOTAL_DOCUMENTS = 15835;
const MARKET_JOBS = 14813;
const COUNT_FIELDS = ["all", "posted", "any", "rawApplied", "applied", "scheduled", "declined", "bid-ready", "bid-completed", "other"];

function normalize(value) {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = normalize(value[key]);
    }
    return output;
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function statusFingerprint(row) {
  const canonical = { applier: String(row.applier) };
  for (const field of ["appliedDate", "scheduledDate", "declinedDate", "bidReadyDate", "bidCompletedDate"]) {
    if (row[field]) canonical[field] = new Date(row[field]).toISOString();
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function emptyCounts(profileId) {
  return {
    profileId, all: MARKET_JOBS, posted: MARKET_JOBS, any: 0, rawApplied: 0,
    applied: 0, scheduled: 0, declined: 0, "bid-ready": 0,
    "bid-completed": 0, other: 0,
  };
}

async function main() {
  const mongo = new MongoClient(sourceUrl);
  await mongo.connect();
  try {
    const source = mongo.db(sourceDbName);
    await assertAuthoritativeAthensDb(source, sourceDbName);
    const firestore = getFirestoreDb();
    const sourceAccounts = await source.collection("account_info").find({}).toArray();
    const accountIds = new Set(sourceAccounts.map((account) => String(account._id)));
    accountIds.add(TEMP_ACCOUNT_ID);
    const resolveProfileId = createProfileIdResolver([
      ...sourceAccounts,
      { _id: TEMP_ACCOUNT_ID, name: "temp" },
    ]);

    const accountSnapshots = await firestore.getAll(...sourceAccounts.map((account) => firestore.collection("account_info").doc(String(account._id))));
    const accountErrors = [];
    for (let index = 0; index < sourceAccounts.length; index += 1) {
      const sourceAccount = { ...sourceAccounts[index] };
      const id = String(sourceAccount._id);
      delete sourceAccount._id;
      sourceAccount.profileId ||= id;
      const destination = accountSnapshots[index];
      if (!destination.exists || digest(sourceAccount) !== digest(destination.data())) accountErrors.push(id);
    }
    if (accountErrors.length) throw new Error(`Account payload mismatch for ${accountErrors.slice(0, 10).join(", ")}`);

    const sourceStatusHashes = new Map();
    const expectedProjections = new Map();
    const expectedCounts = new Map([...accountIds].map((profileId) => [profileId, emptyCounts(profileId)]));
    let expectedProjectionCount = 0;
    for await (const job of source.collection("job_market").find({}, { projection: { status: 1 } })) {
      const jobId = String(job._id);
      const normalized = normalizeCanonicalJobStatuses(job.status, resolveProfileId);
      if (normalized.issues.length) throw new Error(`Source job ${jobId} has invalid status data`);
      const statuses = normalized.statuses;
      sourceStatusHashes.set(jobId, digest(statuses));
      const grouped = new Map();
      for (const status of statuses) {
        const profileId = String(status?.applier || "");
        if (!profileId) continue;
        if (!accountIds.has(profileId)) throw new Error(`Source job ${jobId} references unknown account id ${profileId}`);
        const rows = grouped.get(profileId) || [];
        rows.push(status);
        grouped.set(profileId, rows);
      }
      for (const [profileId, profileStatuses] of grouped) {
        expectedProjectionCount += 1;
        const statusRow = profileStatuses[0];
        expectedProjections.set(jobStatusProjectionId(profileId, jobId), {
          statusRowHash: digest(statusRow),
          statusFingerprint: statusFingerprint(statusRow),
        });
        const row = expectedCounts.get(profileId);
        const contribution = statusContribution(profileStatuses);
        row.any += 1;
        for (const [field, value] of Object.entries(contribution)) row[field] += Number(value || 0);
        if (!Object.values(contribution).some(Boolean)) row.other += 1;
      }
    }
    for (const row of expectedCounts.values()) row.posted = MARKET_JOBS - row.any;

    let firestoreMarketJobs = 0;
    const statusErrors = [];
    const stream = firestore.collection("jobs").where("sourceCatalog", "==", "market").select("status").stream();
    for await (const snapshot of stream) {
      firestoreMarketJobs += 1;
      const expectedHash = sourceStatusHashes.get(snapshot.id);
      if (!expectedHash || expectedHash !== digest(snapshot.data()?.status || [])) statusErrors.push(snapshot.id);
      sourceStatusHashes.delete(snapshot.id);
    }
    if (firestoreMarketJobs !== MARKET_JOBS || sourceStatusHashes.size || statusErrors.length) {
      throw new Error(`Job status payload mismatch: destination=${firestoreMarketJobs}, missing=${sourceStatusHashes.size}, changed=${statusErrors.slice(0, 10).join(",")}`);
    }

    const [jobTotal, projectionTotal, countTotal] = await Promise.all([
      firestore.collection("jobs").count().get(),
      firestore.collection("job_statuses").count().get(),
      firestore.collection("job_status_counts").count().get(),
    ]);
    if (jobTotal.data().count !== TOTAL_DOCUMENTS) throw new Error(`Expected ${TOTAL_DOCUMENTS} jobs, found ${jobTotal.data().count}`);
    if (projectionTotal.data().count !== expectedProjectionCount) throw new Error(`Expected ${expectedProjectionCount} status projections, found ${projectionTotal.data().count}`);
    if (countTotal.data().count !== 35) throw new Error(`Expected 35 status count documents, found ${countTotal.data().count}`);

    const countSnapshots = await firestore.getAll(...[...expectedCounts].map(([profileId]) => firestore.collection("job_status_counts").doc(profileId)));
    const countErrors = [];
    let index = 0;
    for (const [profileId, expected] of expectedCounts) {
      const actual = countSnapshots[index++]?.data() || {};
      if (COUNT_FIELDS.some((field) => Number(actual[field] || 0) !== Number(expected[field] || 0))) countErrors.push(profileId);
    }
    if (countErrors.length) throw new Error(`Status counter mismatch for ${countErrors.slice(0, 10).join(", ")}`);

    const projectionErrors = [];
    for await (const snapshot of firestore.collection("job_statuses")
      .select("schemaVersion", "statusRow", "statusFingerprint").stream()) {
      const expected = expectedProjections.get(snapshot.id);
      const actual = snapshot.data();
      if (
        !expected ||
        Number(actual.schemaVersion) !== 2 ||
        digest(actual.statusRow) !== expected.statusRowHash ||
        actual.statusFingerprint !== expected.statusFingerprint
      ) projectionErrors.push(snapshot.id);
      expectedProjections.delete(snapshot.id);
    }
    if (projectionErrors.length || expectedProjections.size) {
      throw new Error(`Status projection payload mismatch: missing=${expectedProjections.size}, changed=${projectionErrors.slice(0, 10).join(",")}`);
    }

    console.log(JSON.stringify({
      verified: true,
      accounts: sourceAccounts.length,
      jobs: TOTAL_DOCUMENTS,
      marketJobStatusPayloads: firestoreMarketJobs,
      statusProjections: projectionTotal.data().count,
      statusCountDocuments: countTotal.data().count,
      invalidAccountLinks: 0,
    }, null, 2));
  } finally {
    await mongo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

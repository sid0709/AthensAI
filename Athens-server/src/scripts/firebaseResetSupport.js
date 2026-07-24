import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const ATHENS_DB_NAME = "AthensDB";
export const EXPECTED_PROJECT_ID = "drwretail-bm";
export const EXPECTED_BUCKET = "drwretail-bm.firebasestorage.app";
export const PROTECTED_STORAGE_PREFIX = "bid-recordings/";

export const ATHENS_SOURCE_FINGERPRINT = Object.freeze({
  account_info: 34,
  job_market: 14813,
  external_scraped_jobs: 1022,
  mail_messages: 61446,
});

export const DAVID_MOLL_ID = "6a56c8e68579b09746eadb28";
export const TEMP_ACCOUNT_ID = "6a539edfbc313cb3c06f0b40";

export async function assertAuthoritativeAthensDb(db, databaseName) {
  if (databaseName !== ATHENS_DB_NAME) {
    throw new Error(`Refusing migration from ${databaseName || "an unnamed database"}; MONGO_SOURCE_DB must be ${ATHENS_DB_NAME}`);
  }
  const actual = {};
  for (const [collection, expected] of Object.entries(ATHENS_SOURCE_FINGERPRINT)) {
    actual[collection] = await db.collection(collection).countDocuments();
    if (actual[collection] !== expected) {
      throw new Error(`AthensDB fingerprint mismatch for ${collection}: expected ${expected}, found ${actual[collection]}`);
    }
  }
  // Use a string comparison so this guard works with restored BSON ObjectIds and string ids.
  const davidRows = await db.collection("account_info").find({}, { projection: { _id: 1, name: 1 } }).toArray();
  const davidMatch = davidRows.find((row) => String(row._id) === DAVID_MOLL_ID && String(row.name || "").trim() === "David Moll");
  if (!davidMatch) throw new Error(`AthensDB fingerprint mismatch: David Moll must have id ${DAVID_MOLL_ID}`);
  return actual;
}

export async function buildFirebaseInventory({ firestore, bucket }) {
  const collections = [];
  for (const collection of await firestore.listCollections()) {
    const count = (await collection.count().get()).data().count;
    collections.push({ name: collection.id, count });
  }
  collections.sort((left, right) => left.name.localeCompare(right.name));

  const [files] = await bucket.getFiles();
  const storage = {
    objects: files.length,
    bytes: 0,
    protectedObjects: 0,
    protectedBytes: 0,
    deletableObjects: 0,
    deletableBytes: 0,
  };
  for (const file of files) {
    const bytes = Number(file.metadata?.size || 0);
    storage.bytes += bytes;
    if (file.name.startsWith(PROTECTED_STORAGE_PREFIX)) {
      storage.protectedObjects += 1;
      storage.protectedBytes += bytes;
    } else {
      storage.deletableObjects += 1;
      storage.deletableBytes += bytes;
    }
  }
  return { collections, storage };
}

function assertResetTarget({ projectId, bucketName, confirmation }) {
  if (projectId !== EXPECTED_PROJECT_ID) throw new Error(`Refusing reset for unexpected project ${projectId || "(missing)"}`);
  if (bucketName !== EXPECTED_BUCKET) throw new Error(`Refusing reset for unexpected bucket ${bucketName || "(missing)"}`);
  const expected = `${EXPECTED_PROJECT_ID}/(default)/${EXPECTED_BUCKET}`;
  if (confirmation !== expected) {
    throw new Error(`Reset requires FIREBASE_RESET_CONFIRM=${expected}`);
  }
}

export async function resetFirebaseData({ firestore, bucket, projectId, confirmation, outputDir, apply = false }) {
  assertResetTarget({ projectId, bucketName: bucket.name, confirmation });
  const before = await buildFirebaseInventory({ firestore, bucket });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "firebase-reset-inventory-before.json"), JSON.stringify(before, null, 2));
  if (!apply) return { dryRun: true, before };

  for (const collection of await firestore.listCollections()) {
    await firestore.recursiveDelete(collection);
  }

  const [files] = await bucket.getFiles();
  const deletable = files.filter((file) => !file.name.startsWith(PROTECTED_STORAGE_PREFIX));
  for (let offset = 0; offset < deletable.length; offset += 100) {
    await Promise.all(deletable.slice(offset, offset + 100).map((file) => file.delete({ ignoreNotFound: true })));
  }

  const after = await buildFirebaseInventory({ firestore, bucket });
  await writeFile(path.join(outputDir, "firebase-reset-inventory-after.json"), JSON.stringify(after, null, 2));
  if (after.storage.deletableObjects !== 0) throw new Error("Storage cleanup incomplete: non-bid-recording objects remain");
  // New recordings may finish while maintenance is being established. Growth
  // is safe; any decrease means a protected object was lost and is a hard stop.
  if (after.storage.protectedObjects < before.storage.protectedObjects || after.storage.protectedBytes < before.storage.protectedBytes) {
	throw new Error("Protected bid-recordings inventory decreased during reset");
  }
  return { dryRun: false, before, after };
}

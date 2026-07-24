import test from "node:test";
import assert from "node:assert/strict";
import { ATHENS_DB_NAME, DAVID_MOLL_ID, assertAuthoritativeAthensDb } from "./firebaseResetSupport.js";

function sourceDb(counts, accounts = [{ _id: DAVID_MOLL_ID, name: "David Moll" }]) {
  return {
    collection(name) {
      return {
        countDocuments: async () => counts[name] ?? 0,
        find: () => ({ toArray: async () => accounts }),
      };
    },
  };
}

const counts = { account_info: 34, job_market: 14813, external_scraped_jobs: 1022, mail_messages: 61446 };

test("authoritative guard rejects AIMS_local before reading data", async () => {
  await assert.rejects(() => assertAuthoritativeAthensDb(sourceDb(counts), "AIMS_local"), /must be AthensDB/);
});

test("authoritative guard accepts the exact AthensDB fingerprint", async () => {
  assert.deepEqual(await assertAuthoritativeAthensDb(sourceDb(counts), ATHENS_DB_NAME), counts);
});

test("authoritative guard rejects a changed source count", async () => {
  await assert.rejects(
    () => assertAuthoritativeAthensDb(sourceDb({ ...counts, job_market: 14812 }), ATHENS_DB_NAME),
    /fingerprint mismatch for job_market/,
  );
});

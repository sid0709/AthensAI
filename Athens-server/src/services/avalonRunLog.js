/**
 * Avalon apply-run logging: a durable, debuggable record of every auto-apply run.
 *
 * Two sinks:
 *  1. Local JSONL file per run under `.local/logs/avalon/<YYYY-MM-DD>/<runId>.jsonl`
 *     — one JSON event per line, appended as events stream in (survives crashes).
 *  2. MongoDB `avalon_apply_runs` — one document per run with rolled-up metadata
 *     + the full event array, so runs are queryable for debugging.
 *
 * Nothing here is vendor/site specific; it just records what the pipeline did.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { avalonRunsCollection } from "../db/mongo.js";
import { getFirestoreDb } from "./firebase/firebaseAdmin.js";
import { putBinaryObject, readStoredObject, storageSlug } from "./firebase/objectStore.js";

const LOG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".local", "logs", "avalon");

const clean = (v) => String(v ?? "").trim();

function useCloudLogs() {
  return String(process.env.DATABASE_BACKEND || "").toLowerCase() === "firestore" || process.env.NODE_ENV === "production";
}

/** YYYY-MM-DD from an ISO-ish timestamp (or now). */
function dayFolder(ts) {
  const d = ts ? new Date(ts) : new Date();
  const iso = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  return iso.slice(0, 10);
}

function safeId(s) {
  return clean(s).replace(/[^\w.\-]+/g, "_").slice(0, 120) || "run";
}

/** Absolute path to a run's JSONL log file (creating the day folder). */
async function logFilePath(runId, startedAt) {
  const dir = path.join(LOG_ROOT, dayFolder(startedAt));
  await fsp.mkdir(dir, { recursive: true });
  return path.join(dir, `${safeId(runId)}.jsonl`);
}

/** Append one JSONL line (best-effort — logging must never throw into callers). */
async function appendJsonl(file, obj) {
  try {
    await fsp.appendFile(file, `${JSON.stringify(obj)}\n`, "utf8");
  } catch (err) {
    console.warn("[avalon-log] file append failed:", err.message);
  }
}

/**
 * Record a batch of events for a run. Idempotent-ish: creates the Mongo doc on
 * first call (with meta), then $push-es events + updates rolling fields.
 *
 * @param {{
 *   runId: string,
 *   applierName?: string,
 *   job?: object,
 *   meta?: object,          // start-of-run metadata (url, résumé info, etc.)
 *   events?: Array<object>, // [{ at, level, phase, message, data }]
 *   status?: string,        // 'running' | 'applied' | 'failed' | 'needs_verification' | ...
 *   finished?: boolean,
 * }} payload
 */
export async function recordApplyRun(payload = {}) {
  const runId = clean(payload.runId);
  if (!runId) throw new Error("runId is required");

  const events = Array.isArray(payload.events) ? payload.events : [];
  const now = new Date();
  const startedAt = payload.meta?.startedAt || now.toISOString();

  const lines = [];
  if (payload.meta) {
    lines.push({ at: now.toISOString(), kind: "meta", ...payload.meta, runId });
  }
  for (const ev of events) {
    lines.push({ runId, ...ev });
  }
  if (payload.status || payload.finished) {
    lines.push({
      at: now.toISOString(),
      kind: "status",
      status: payload.status,
      finished: Boolean(payload.finished),
      runId,
    });
  }

  let file;
  if (useCloudLogs()) {
    const jsonl = Buffer.from(lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length ? "\n" : ""), "utf8");
    if (jsonl.length) {
      const digest = createHash("sha256").update(jsonl).digest("hex");
      const objectPath = `avalon-run-logs/${storageSlug(payload.applierName)}/${storageSlug(runId)}/${now.toISOString().replace(/[:.]/g, "-")}-${digest.slice(0, 16)}.jsonl`;
      const stored = await putBinaryObject({
        buffer: jsonl,
        objectPath,
        mimeType: "application/x-ndjson",
        metadata: { applierName: clean(payload.applierName), runId, kind: "avalon-run-log" },
      });
      file = `gcs://${objectPath}`;
      const chunkId = createHash("sha256").update(`${runId}\0${digest}`).digest("hex");
      await getFirestoreDb().collection("avalon_run_log_chunks").doc(chunkId).set({
        runId,
        applierName: clean(payload.applierName) || null,
        object: stored.file,
        createdAt: now,
        eventCount: events.length,
      }, { merge: false });
    } else {
      file = `gcs://avalon-run-logs/${storageSlug(payload.applierName)}/${storageSlug(runId)}/`;
    }
  } else {
    file = await logFilePath(runId, startedAt);
    for (const line of lines) await appendJsonl(file, line);
  }

  // --- Sink 2: MongoDB rollup (best-effort).
  try {
    if (avalonRunsCollection) {
      const setOnInsert = {
        runId,
        applierName: clean(payload.applierName) || null,
        job: payload.job ?? null,
        startedAt: new Date(startedAt),
        logFile: file,
      };
      const set = { updatedAt: now };
      if (payload.meta) set.meta = payload.meta;
      if (payload.status) set.status = payload.status;
      if (payload.finished) set.finishedAt = now;

      const update = {
        $setOnInsert: setOnInsert,
        $set: set,
      };
      if (events.length && !useCloudLogs()) update.$push = { events: { $each: events } };
      if (useCloudLogs()) update.$set.logStoragePrefix = `avalon-run-logs/${storageSlug(payload.applierName)}/${storageSlug(runId)}/`;
      await avalonRunsCollection.updateOne(
        { runId },
        update,
        { upsert: true },
      );
    }
  } catch (err) {
    console.warn("[avalon-log] mongo upsert failed:", err.message);
  }

  return { ok: true, runId, logFile: file, appended: events.length };
}

/** List recent runs (metadata only — no event arrays) for a debugging view. */
export async function listApplyRuns({ applierName, limit = 50 } = {}) {
  if (!avalonRunsCollection) return [];
  const filter = {};
  const name = clean(applierName);
  if (name) filter.applierName = name;
  return avalonRunsCollection
    .find(filter, { projection: { events: 0 } })
    .sort({ startedAt: -1 })
    .limit(Math.max(1, Math.min(200, Number(limit) || 50)))
    .toArray();
}

/** Fetch a single run with its full event array. */
export async function getApplyRun(runId) {
  if (!avalonRunsCollection) return null;
  const normalized = clean(runId);
  const run = await avalonRunsCollection.findOne({ runId: normalized });
  if (!run || !useCloudLogs()) return run;
  const chunks = await getFirestoreDb().collection("avalon_run_log_chunks").where("runId", "==", normalized).orderBy("createdAt", "asc").get();
  const events = [];
  for (const chunk of chunks.docs) {
    const data = chunk.data();
    if (!data.object?.storagePath) continue;
    const bytes = await readStoredObject({ object: data.object });
    for (const line of bytes.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (!event.kind || !["meta", "status"].includes(event.kind)) events.push(event);
    }
  }
  return { ...run, events };
}

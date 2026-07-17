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
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { avalonRunsCollection } from "../db/mongo.js";

const LOG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".local", "logs", "avalon");

const clean = (v) => String(v ?? "").trim();

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

  // --- Sink 1: local JSONL file (append every event).
  const file = await logFilePath(runId, startedAt);
  if (payload.meta) {
    await appendJsonl(file, { at: now.toISOString(), kind: "meta", ...payload.meta, runId });
  }
  for (const ev of events) {
    await appendJsonl(file, { runId, ...ev });
  }
  if (payload.status || payload.finished) {
    await appendJsonl(file, {
      at: now.toISOString(),
      kind: "status",
      status: payload.status,
      finished: Boolean(payload.finished),
      runId,
    });
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

      await avalonRunsCollection.updateOne(
        { runId },
        {
          $setOnInsert: setOnInsert,
          $set: set,
          ...(events.length ? { $push: { events: { $each: events } } } : {}),
        },
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
  return avalonRunsCollection.findOne({ runId: clean(runId) });
}

/**
 * Main-thread pool that dispatches PDF work to worker_threads.
 * Chromium stays off the API event loop so Avalon/SSE stay responsive.
 */

import cluster from "node:cluster";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pdfRenderLimiter } from "../../utils/concurrency.js";

function envInt(name, fallback) {
	const n = Number.parseInt(String(process.env[name] ?? ""), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Under Node cluster, each process keeps ONE pdf worker_thread with the full
// Chromium pool — high PDF concurrency via the limiter, without N×N browsers.
const DEFAULT_PDF_THREADS = cluster.isWorker ? 1 : Math.max(2, Math.min(4, envInt("PUPPETEER_BROWSER_POOL", 6)));
const WORKER_COUNT = envInt("PDF_WORKER_THREADS", DEFAULT_PDF_THREADS);
const WORKER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pdfRenderWorker.js");

/** @type {{ worker: Worker, busy: boolean, pending: Map<number, { resolve: Function, reject: Function }> }[]} */
const slots = [];
let nextId = 1;
let rr = 0;
let shuttingDown = false;

function spawnSlot() {
	const worker = new Worker(WORKER_SCRIPT, {
		workerData: { browserPoolSize: envInt("PUPPETEER_BROWSER_POOL", 6) },
		env: process.env,
	});
	const slot = {
		worker,
		busy: false,
		pending: new Map(),
	};

	worker.on("message", (msg) => {
		if (!msg || typeof msg.id !== "number") return;
		const waiter = slot.pending.get(msg.id);
		if (!waiter) return;
		slot.pending.delete(msg.id);
		slot.busy = slot.pending.size > 0;
		if (msg.ok) waiter.resolve(msg);
		else waiter.reject(new Error(msg.error || "PDF worker failed"));
	});

	worker.on("error", (err) => {
		console.error("[pdf-pool] worker error:", err.message);
		for (const [, waiter] of slot.pending) {
			waiter.reject(err);
		}
		slot.pending.clear();
		slot.busy = false;
	});

	worker.on("exit", (code) => {
		for (const [, waiter] of slot.pending) {
			waiter.reject(new Error(`PDF worker exited (${code})`));
		}
		slot.pending.clear();
		const idx = slots.indexOf(slot);
		if (idx >= 0) slots.splice(idx, 1);
		if (!shuttingDown) {
			console.warn("[pdf-pool] worker exited — respawning");
			slots.push(spawnSlot());
		}
	});

	return slot;
}

function ensurePool() {
	while (slots.length < WORKER_COUNT) {
		slots.push(spawnSlot());
	}
}

function pickSlot() {
	ensurePool();
	// Prefer an idle slot; otherwise round-robin (queue inside worker + limiter).
	const idle = slots.find((s) => !s.busy);
	if (idle) return idle;
	const slot = slots[rr % slots.length];
	rr += 1;
	return slot;
}

function dispatch(type, payload, transferList) {
	if (shuttingDown) return Promise.reject(new Error("PDF pool is shutting down"));
	const slot = pickSlot();
	const id = nextId++;
	slot.busy = true;
	return new Promise((resolve, reject) => {
		slot.pending.set(id, { resolve, reject });
		slot.worker.postMessage({ id, type, payload }, transferList);
	});
}

/**
 * @param {object} opts
 * @param {boolean} [opts.asBase64]
 * @returns {Promise<{ buffer?: Buffer, base64?: string, byteLength: number }>}
 */
export async function renderPdfInWorker(opts = {}) {
	return pdfRenderLimiter.run(async () => {
		const result = await dispatch("render", opts);
		if (opts.asBase64) {
			return { base64: result.base64, byteLength: result.byteLength };
		}
		return {
			buffer: Buffer.from(result.buffer),
			byteLength: result.byteLength,
		};
	});
}

/** Encode an existing PDF buffer to base64 off the main thread. */
export async function encodeBufferBase64(input) {
	const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
	const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	const result = await dispatch("encode", { buffer: ab }, [ab]);
	return result.base64;
}

export async function shutdownPdfPool() {
	shuttingDown = true;
	const closing = slots.splice(0, slots.length).map(async (slot) => {
		try {
			await new Promise((resolve) => {
				const timer = setTimeout(resolve, 5000);
				slot.worker.once("exit", () => {
					clearTimeout(timer);
					resolve();
				});
				slot.worker.postMessage({ id: 0, type: "shutdown" });
				setTimeout(() => slot.worker.terminate().catch(() => {}), 4000);
			});
		} catch {
			await slot.worker.terminate().catch(() => {});
		}
	});
	await Promise.all(closing);
}

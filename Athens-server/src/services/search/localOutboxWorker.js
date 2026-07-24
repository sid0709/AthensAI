import { processAlgoliaOutbox } from "./algoliaJobs.js";

let timer = null;
let running = false;
let stopped = true;

function configured() {
	return Boolean(String(process.env.ALGOLIA_APP_ID || "").trim() && String(process.env.ALGOLIA_ADMIN_API_KEY || "").trim());
}

async function runOnce() {
	if (running || stopped) return;
	running = true;
	try {
		const batchSize = Math.max(1, Number(process.env.SEARCH_OUTBOX_BATCH_SIZE || 100));
		let result;
		do {
			result = await processAlgoliaOutbox(batchSize);
		} while (!stopped && result.remaining);
	} catch (error) {
		console.error("[search-outbox] local worker failed; pending rows will retry:", error?.message || error);
	} finally {
		running = false;
	}
}

export function startLocalSearchOutboxWorker() {
	if (timer || !configured()) {
		if (!configured()) console.warn("[search-outbox] Algolia is not configured; local outbox worker is disabled");
		return;
	}
	stopped = false;
	const intervalMs = Math.max(1000, Number(process.env.SEARCH_OUTBOX_INTERVAL_MS || 5000));
	timer = setInterval(() => void runOnce(), intervalMs);
	timer.unref?.();
	void runOnce();
	console.log(`[search-outbox] local worker started (interval=${intervalMs}ms)`);
}

export function stopLocalSearchOutboxWorker() {
	stopped = true;
	if (timer) clearInterval(timer);
	timer = null;
}

export const localOutboxWorkerTest = { configured, runOnce };

import { createLimiter } from '../utils/concurrency.js';

export const MAX_JOB_BULK_SIZE = 50;
export const DEFAULT_JOB_BULK_CONCURRENCY = 5;

function configuredConcurrency() {
	const value = Number.parseInt(String(process.env.JOB_BULK_CONCURRENCY || ''), 10);
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_JOB_BULK_CONCURRENCY;
	return Math.min(DEFAULT_JOB_BULK_CONCURRENCY, value);
}

const ingestLimiter = createLimiter({ concurrency: configuredConcurrency() });

function isBlocked(result) {
	return String(result?.reason || '').toLowerCase().includes('blocked by rule');
}

export function summarizeJobBulkResults(results) {
	const summary = { total: results.length, created: 0, duplicate: 0, blocked: 0, errors: 0 };
	for (const result of results) {
		if (result?.created === true) summary.created += 1;
		else if (result?.duplicate === true) summary.duplicate += 1;
		else if (isBlocked(result)) summary.blocked += 1;
		else summary.errors += 1;
	}
	return summary;
}

/**
 * Run the canonical single-job ingest path with a process-wide concurrency cap.
 * Results retain input order so scraper rows can be reconciled deterministically.
 */
export async function ingestJobsBulk(jobs, createJob, { limiter = ingestLimiter } = {}) {
	const results = await Promise.all(
		jobs.map((job, index) => limiter.run(async () => {
			try {
				const result = await createJob(job, index);
				return {
					...(result?.payload || {}),
					index,
					statusCode: Number(result?.statusCode || 500),
				};
			} catch (error) {
				return {
					index,
					statusCode: 500,
					success: false,
					created: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		})),
	);

	return { results, summary: summarizeJobBulkResults(results) };
}

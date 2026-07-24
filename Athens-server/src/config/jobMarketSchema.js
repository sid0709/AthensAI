/** Current job_market document schema version. */
export const JOB_MARKET_MODEL_VERSION = '2026.07.07';

/**
 * Ingest provenance for jobs uploaded by extension-v2.
 * Distinct from modelVersion (schema stamp) and sourceVersion (ATS map).
 * Jobs with this value are beta-tier-only in Athens job list / detail APIs.
 */
export const JOB_MARKET_EXTENSION_VERSION_V2 = 'v2';

/** Header extension-v2 sends on every API request. */
export const EXTENSION_V2_CLIENT_HEADER = 'extension-v2';

/** Mongo clause that hides extension-v2 jobs from non-beta viewers. */
export function excludeExtensionV2JobsFilter() {
	if (String(process.env.DATABASE_BACKEND || "").trim().toLowerCase() === "firestore") {
		return { extensionV2: false };
	}
	return { version: { $ne: JOB_MARKET_EXTENSION_VERSION_V2 } };
}

/** Fields scraped by the Extension that are not stored on job_market. */
export const SCRAPER_ONLY_JOB_FIELDS = [
	'tags',
	'applicants',
	'skillAnalysis',
	'scoreSalary',
	'scoreApplicant',
	'scoreApplication',
];

/** Remove scraper-only fields from a job payload before persistence. */
export function stripScraperOnlyJobFields(job) {
	for (const field of SCRAPER_ONLY_JOB_FIELDS) {
		delete job[field];
	}
	return job;
}

/** MongoDB $unset map for scraper-only fields. */
export function scraperOnlyJobFieldsUnset() {
	return Object.fromEntries(SCRAPER_ONLY_JOB_FIELDS.map((field) => [field, '']));
}

import { inferJobSource, SOURCE_MAP_VERSION } from '../config/jobSources.js';

/** Denormalized fields stored on ingest for list filtering. */
export function attachStaticScoreFields(job) {
	return {
		source: inferJobSource(job.applyLink),
		sourceVersion: SOURCE_MAP_VERSION,
	};
}

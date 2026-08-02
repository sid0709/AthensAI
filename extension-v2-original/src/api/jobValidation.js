function hasText(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
	if (!hasText(value)) return false;
	try {
		const url = new URL(value.trim());
		return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
	} catch {
		return false;
	}
}

/**
 * Validate the complete job payload before it can leave the extension.
 * Arrays and metadata objects may legitimately be empty, but they must exist
 * with the expected shape. Core scraped content must be non-empty.
 */
export function getJobValidationIssues(job) {
	const issues = [];

	if (!isRecord(job)) return ['Job data'];
	if (!isHttpUrl(job.applyLink)) issues.push('Application link');
	if (typeof job.id !== 'number' || !Number.isFinite(job.id)) issues.push('Job ID');
	if (!hasText(job.postedAgo)) issues.push('Posted date');
	if (!hasText(job.title)) issues.push('Job title');
	if (!hasText(job.description)) issues.push('Job description');
	if (!isHttpUrl(job.companyLink)) issues.push('Company link');
	if (!isRecord(job.details)) issues.push('Job details');
	if (!Array.isArray(job.skills)) issues.push('Skills');

	if (!isRecord(job.company)) {
		issues.push('Company');
	} else {
		if (!hasText(job.company.name)) issues.push('Company name');
		if (!isHttpUrl(job.company.logo)) issues.push('Company logo');
		if (!Array.isArray(job.company.tags)) issues.push('Company tags');
	}

	return issues;
}

export class IncompleteJobDataError extends Error {
	constructor(issues) {
		const uniqueIssues = [...new Set(issues)];
		super(`Skipping job. Missing or invalid required job data: ${uniqueIssues.join(', ')}.`);
		this.name = 'IncompleteJobDataError';
		this.issues = uniqueIssues;
	}
}

export function assertCompleteJob(job) {
	const issues = getJobValidationIssues(job);
	if (issues.length) throw new IncompleteJobDataError(issues);
	return job;
}

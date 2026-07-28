/** Canonical role labels stored on job_market.titleScanned. */
export const TITLE_SCAN_ROLES = [
	'Software Engineer',
	'DevOps',
	'Data Engineer',
	'AI engineer',
	'Healthcare Engineer',
	'Others',
];

export const TITLE_SCAN_ROLE_SET = new Set(TITLE_SCAN_ROLES);

export const DEFAULT_TITLE_SCAN_ROLE = 'Others';

/**
 * Deterministic fallback for jobs that have not completed the optional AI title
 * scan yet. Rules intentionally mirror jobTitleScanPrompt.js so the Role filter
 * is useful immediately and an eventual AI result can replace this value.
 */
export function inferTitleScanRole(title) {
	const value = String(title || '')
		.trim()
		.toLowerCase()
		.replace(/[._/]+/g, ' ')
		.replace(/\s+/g, ' ');
	if (!value) return DEFAULT_TITLE_SCAN_ROLE;

	const engineeringSignal = /\b(?:engineer|engineering|developer|development|programmer|architect|scientist|informatics)\b/.test(value);
	if (
		engineeringSignal &&
		/\b(?:health(?:care)?|clinical|biomedical|bioinformatics|medical|fhir|hl7|digital health|health informatics)\b/.test(value)
	) {
		return 'Healthcare Engineer';
	}
	if (
		engineeringSignal &&
		/\b(?:machine learning|artificial intelligence|ai|ml|llm|genai|generative ai|nlp|computer vision|applied scientist|mlops)\b/.test(value)
	) {
		return 'AI engineer';
	}
	if (
		/\b(?:data engineer(?:ing)?|analytics engineer(?:ing)?|data platform|data pipeline|data warehouse|etl|elt|spark|airflow|dbt|kafka)\b/.test(value)
	) {
		return 'Data Engineer';
	}
	if (
		/\b(?:devops|devsecops|site reliability|sre|platform engineer(?:ing)?|infrastructure engineer(?:ing)?|release engineer(?:ing)?|ci cd|kubernetes platform)\b/.test(value)
	) {
		return 'DevOps';
	}
	if (
		/\b(?:cloud|network|security|rpa|hardware|firmware|support|sales) engineer(?:ing)?\b/.test(value) ||
		/\b(?:solutions? architect|it admin(?:istrator)?|business analyst|product manager|designer|recruiter)\b/.test(value)
	) {
		return DEFAULT_TITLE_SCAN_ROLE;
	}
	if (
		/\b(?:software engineer(?:ing)?|swe|full[ -]?stack|front[ -]?end|back[ -]?end|mobile developer|ios developer|android developer|web developer|application developer|qa engineer|quality engineer|developer|programmer|engineering manager|software development manager|product engineer)\b/.test(value)
	) {
		return 'Software Engineer';
	}
	return DEFAULT_TITLE_SCAN_ROLE;
}

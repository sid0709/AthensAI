import {
	EXTENSION_V2_CLIENT_HEADER,
	JOB_MARKET_EXTENSION_VERSION_V2,
} from '../config/jobMarketSchema.js';

const ORIGINAL_REQUIRED_FIELDS = [
	'applyLink',
	'id',
	'postedAgo',
	'company',
	'title',
	'details',
	'description',
	'skills',
	'companyLink',
];

const RELATIVE_UNIT_MS = {
	second: 1000,
	minute: 60 * 1000,
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
	year: 365 * 24 * 60 * 60 * 1000,
};

const RELATIVE_UNIT_ALIASES = {
	s: 'second',
	sec: 'second',
	secs: 'second',
	second: 'second',
	seconds: 'second',
	m: 'minute',
	min: 'minute',
	mins: 'minute',
	minute: 'minute',
	minutes: 'minute',
	h: 'hour',
	hr: 'hour',
	hrs: 'hour',
	hour: 'hour',
	hours: 'hour',
	d: 'day',
	day: 'day',
	days: 'day',
	w: 'week',
	wk: 'week',
	wks: 'week',
	week: 'week',
	weeks: 'week',
	mo: 'month',
	mos: 'month',
	month: 'month',
	months: 'month',
	y: 'year',
	yr: 'year',
	yrs: 'year',
	year: 'year',
	years: 'year',
};

function isRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function trimText(value) {
	return typeof value === 'string' ? value.trim() : value;
}

function trimUniqueStrings(values) {
	if (!Array.isArray(values)) return [];
	const seen = new Set();
	const normalized = [];
	for (const value of values) {
		const text = String(value ?? '').trim();
		if (!text) continue;
		const key = text.toLocaleLowerCase('en-US');
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push(text);
	}
	return normalized;
}

function validDate(value) {
	if (!value) return null;
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function validHttpUrl(value) {
	if (typeof value !== 'string' || !value.trim()) return false;
	try {
		const url = new URL(value.trim());
		return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
	} catch {
		return false;
	}
}

/** Detect the exact unmarked compatibility payload emitted by extension-v2-original. */
export function isExtensionV2OriginalPayload(payload, clientHeader = '') {
	if (!isRecord(payload)) return false;
	if (String(clientHeader || '').trim()) return false;
	if (hasOwn(payload, 'version') || hasOwn(payload, 'tags') || hasOwn(payload, 'applicants')) return false;
	if (!ORIGINAL_REQUIRED_FIELDS.every((field) => hasOwn(payload, field))) return false;
	if (typeof payload.id !== 'number' || !Number.isFinite(payload.id)) return false;
	if (!isRecord(payload.company) || !isRecord(payload.details) || !Array.isArray(payload.skills)) return false;
	if (!hasOwn(payload.company, 'name') || !hasOwn(payload.company, 'tags') || !hasOwn(payload.company, 'logo')) return false;
	if (!Array.isArray(payload.company.tags)) return false;

	return ['applyLink', 'postedAgo', 'title', 'description', 'companyLink']
		.every((field) => typeof payload[field] === 'string')
		&& typeof payload.company.name === 'string'
		&& typeof payload.company.logo === 'string';
}

/** Resolve explicit v2 provenance before considering the original-payload heuristic. */
export function classifyJobMarketIngest(payload, clientHeader = '') {
	const client = String(clientHeader || '').trim().toLowerCase();
	const version = typeof payload?.version === 'string' ? payload.version.trim() : '';
	if (client === EXTENSION_V2_CLIENT_HEADER || version === JOB_MARKET_EXTENSION_VERSION_V2) {
		return { kind: 'extension-v2', fromExtensionV2: true, client };
	}
	if (isExtensionV2OriginalPayload(payload, client)) {
		return { kind: 'extension-v2-original', fromExtensionV2: true, client };
	}
	return {
		kind: client ? 'internal' : 'extension',
		fromExtensionV2: false,
		client,
	};
}

/** Apply the trusted market provenance stamp selected by the ingest classifier. */
export function stampJobMarketIngestVersion(job, ingest) {
	if (ingest?.fromExtensionV2) {
		job.version = JOB_MARKET_EXTENSION_VERSION_V2;
	} else {
		delete job.version;
	}
	return job;
}

/** Normalize the original extension payload without mutating the request body. */
export function normalizeExtensionV2OriginalJob(payload) {
	const company = isRecord(payload?.company) ? payload.company : {};
	const details = isRecord(payload?.details) ? payload.details : {};
	const normalizedDetails = Object.fromEntries(
		Object.entries(details)
			.map(([key, value]) => [key, trimText(value)])
			.filter(([, value]) => value !== ''),
	);

	return {
		...payload,
		applyLink: trimText(payload?.applyLink),
		...(typeof payload?.url === 'string' ? { url: payload.url.trim() } : {}),
		postedAgo: trimText(payload?.postedAgo),
		title: trimText(payload?.title),
		description: trimText(payload?.description),
		companyLink: trimText(payload?.companyLink),
		details: normalizedDetails,
		skills: trimUniqueStrings(payload?.skills),
		company: {
			...company,
			name: trimText(company.name),
			logo: trimText(company.logo),
			tags: trimUniqueStrings(company.tags),
		},
	};
}

/** Validate only heuristic original-v2 jobs; explicit and legacy clients retain their contract. */
export function validateExtensionV2OriginalJob(job) {
	if (typeof job?.title !== 'string' || !job.title.trim()) {
		return { valid: false, error: 'Job title cannot be empty' };
	}
	if (typeof job?.company?.name !== 'string' || !job.company.name.trim()) {
		return { valid: false, error: 'Company name cannot be empty' };
	}
	if (!validHttpUrl(job?.applyLink)) {
		return { valid: false, error: 'Application URL must be a valid HTTP(S) URL' };
	}
	return { valid: true };
}

/** Resolve explicit dates and common human-relative posting times to an ISO timestamp. */
export function resolveJobPostedAt(job, now = new Date()) {
	const explicitPostedAt = validDate(job?.postedAt);
	if (explicitPostedAt) return explicitPostedAt.toISOString();

	const base = validDate(now) || new Date();
	const raw = typeof job?.postedAgo === 'string' ? job.postedAgo.trim().toLowerCase() : '';
	const relative = raw.replace(/^posted\s+/, '').replace(/^about\s+/, '').trim();
	if (!relative || relative === 'now' || relative === 'just now' || relative === 'today') {
		return base.toISOString();
	}
	if (relative === 'yesterday') {
		return new Date(base.getTime() - RELATIVE_UNIT_MS.day).toISOString();
	}

	const match = relative.match(/^(\d+|a|an|one)\s*(\+)?\s*([a-z]+)(?:\s+ago)?$/i);
	if (!match) return base.toISOString();
	const amount = /^(a|an|one)$/i.test(match[1]) ? 1 : Number.parseInt(match[1], 10);
	const unit = RELATIVE_UNIT_ALIASES[match[3].toLowerCase()];
	if (!Number.isFinite(amount) || !unit) return base.toISOString();
	return new Date(base.getTime() - amount * RELATIVE_UNIT_MS[unit]).toISOString();
}

/** Keep duplicate responses machine-readable for every extension generation. */
export function duplicateJobResult({ existingId = '', reason = 'Duplicate job' } = {}) {
	const text = String(reason || 'Duplicate job').trim();
	return {
		success: false,
		created: false,
		duplicate: true,
		existingId: existingId ? String(existingId) : '',
		reason: /duplicate/i.test(text) ? text : `Duplicate: ${text}`,
	};
}

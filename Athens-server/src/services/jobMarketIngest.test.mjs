import test from 'node:test';
import assert from 'node:assert/strict';
import { isExtensionV2Job } from '../config/jobMarketSchema.js';
import {
	classifyJobMarketIngest,
	duplicateJobResult,
	isWithinDuplicateDateWindow,
	isExtensionV2OriginalPayload,
	normalizeExtensionV2OriginalJob,
	requiresClientDuplicateWindow,
	resolveJobPostedAt,
	stampJobMarketIngestVersion,
	validateExtensionV2OriginalJob,
	validateClientDuplicateWindowDays,
} from './jobMarketIngest.js';

function originalPayload(overrides = {}) {
	return {
		applyLink: ' https://jobs.example.com/123 ',
		id: 1785258000000,
		postedAgo: ' 2 days ago ',
		company: {
			name: ' Example Corp ',
			tags: [' SaaS ', 'saas', '', ' Enterprise '],
			logo: ' https://cdn.example.com/logo.png ',
		},
		title: ' Senior Backend Engineer ',
		details: {
			position: ' Chicago, IL ',
			remote: ' Remote ',
			money: ' ',
		},
		description: ' Build reliable services. ',
		skills: [' Node.js ', 'node.js', '', ' Firestore '],
		companyLink: ' https://example.com/about ',
		...overrides,
	};
}

test('original payload is classified, normalized, and stamped as extension v2', () => {
	const payload = originalPayload();
	const ingest = classifyJobMarketIngest(payload);
	assert.equal(isExtensionV2OriginalPayload(payload), true);
	assert.equal(ingest.kind, 'extension-v2-original');
	assert.equal(ingest.fromExtensionV2, true);

	const normalized = normalizeExtensionV2OriginalJob(payload);
	stampJobMarketIngestVersion(normalized, ingest);
	assert.equal(normalized.title, 'Senior Backend Engineer');
	assert.equal(normalized.company.name, 'Example Corp');
	assert.equal(normalized.applyLink, 'https://jobs.example.com/123');
	assert.equal(normalized.companyLink, 'https://example.com/about');
	assert.equal(normalized.company.logo, 'https://cdn.example.com/logo.png');
	assert.deepEqual(normalized.skills, ['Node.js', 'Firestore']);
	assert.deepEqual(normalized.company.tags, ['SaaS', 'Enterprise']);
	assert.deepEqual(normalized.details, { position: 'Chicago, IL', remote: 'Remote' });
	assert.equal(isExtensionV2Job(normalized), true);
	assert.equal(payload.title, ' Senior Backend Engineer ');
});

test('legacy payload markers prevent original-v2 heuristic classification', () => {
	for (const marker of ['tags', 'applicants']) {
		const ingest = classifyJobMarketIngest(originalPayload({ [marker]: [] }));
		assert.equal(ingest.kind, 'extension');
		assert.equal(ingest.fromExtensionV2, false);
		const stamped = stampJobMarketIngestVersion({ version: 'untrusted' }, ingest);
		assert.equal(Object.hasOwn(stamped, 'version'), false);
	}
});

test('explicit current-v2 markers remain authoritative', () => {
	assert.equal(classifyJobMarketIngest({ title: 'Header job' }, 'extension-v2').fromExtensionV2, true);
	assert.equal(classifyJobMarketIngest({ title: 'Version job', version: 'v2' }).fromExtensionV2, true);
});

test('internal manual clients never use the original-payload heuristic', () => {
	const ingest = classifyJobMarketIngest(originalPayload(), 'agent-manual');
	assert.equal(ingest.kind, 'internal');
	assert.equal(ingest.fromExtensionV2, false);
});

test('original validation requires title, company, and an HTTP(S) application URL', () => {
	const valid = normalizeExtensionV2OriginalJob(originalPayload());
	assert.deepEqual(validateExtensionV2OriginalJob(valid), { valid: true });

	const cases = [
		[originalPayload({ title: '  ' }), 'Job title cannot be empty'],
		[originalPayload({ company: { name: ' ', tags: [], logo: '' } }), 'Company name cannot be empty'],
		[originalPayload({ applyLink: 'javascript:alert(1)' }), 'Application URL must be a valid HTTP(S) URL'],
		[originalPayload({ applyLink: '/jobs/123' }), 'Application URL must be a valid HTTP(S) URL'],
	];
	for (const [payload, error] of cases) {
		const result = validateExtensionV2OriginalJob(normalizeExtensionV2OriginalJob(payload));
		assert.deepEqual(result, { valid: false, error });
	}
});

test('extension jobs require a client-controlled duplicate window', () => {
	const payload = { tags: [], applicants: {} };
	const ingest = classifyJobMarketIngest(payload);
	assert.equal(requiresClientDuplicateWindow(payload, ingest), true);
	assert.deepEqual(validateClientDuplicateWindowDays(undefined, { required: true }), {
		valid: false,
		days: null,
		error: 'duplicateWindowDays is required for extension jobs',
	});
	assert.deepEqual(validateClientDuplicateWindowDays(14, { required: true }), {
		valid: true,
		days: 14,
		error: null,
	});
	assert.equal(validateClientDuplicateWindowDays(14.5, { required: true }).valid, false);
});

test('URL duplicate dates honor the client-provided 14-day window', () => {
	const existing = new Date('2026-01-01T00:00:00.000Z');
	assert.equal(
		isWithinDuplicateDateWindow(existing, new Date('2026-01-15T00:00:00.000Z'), 14),
		true,
	);
	assert.equal(
		isWithinDuplicateDateWindow(existing, new Date('2026-01-15T00:00:00.001Z'), 14),
		false,
	);
});

test('relative posting-time variants resolve from a deterministic clock', () => {
	const now = new Date('2026-07-28T12:00:00.000Z');
	const variants = [
		['5 minutes ago', '2026-07-28T11:55:00.000Z'],
		['2 hours ago', '2026-07-28T10:00:00.000Z'],
		['3 days ago', '2026-07-25T12:00:00.000Z'],
		['2 weeks ago', '2026-07-14T12:00:00.000Z'],
		['2 months ago', '2026-05-29T12:00:00.000Z'],
		['1 year ago', '2025-07-28T12:00:00.000Z'],
		['today', '2026-07-28T12:00:00.000Z'],
		['yesterday', '2026-07-27T12:00:00.000Z'],
		['30+ days ago', '2026-06-28T12:00:00.000Z'],
		['12h ago', '2026-07-28T00:00:00.000Z'],
	];
	for (const [postedAgo, expected] of variants) {
		assert.equal(resolveJobPostedAt({ postedAgo }, now), expected, postedAgo);
	}
	assert.equal(
		resolveJobPostedAt({ postedAt: '2026-01-02T03:04:05Z', postedAgo: 'today' }, now),
		'2026-01-02T03:04:05.000Z',
	);
	assert.equal(resolveJobPostedAt({ postedAgo: 'unknown' }, now), now.toISOString());
});

test('duplicate response retains contract and always identifies the reason as Duplicate', () => {
	assert.deepEqual(duplicateJobResult({
		existingId: 42,
		reason: 'Job with this URL has been posted within the last 30 days',
	}), {
		success: false,
		created: false,
		duplicate: true,
		existingId: '42',
		reason: 'Duplicate: Job with this URL has been posted within the last 30 days',
	});
	assert.equal(
		duplicateJobResult({ reason: 'Duplicate job with this company and title' }).reason,
		'Duplicate job with this company and title',
	);
});

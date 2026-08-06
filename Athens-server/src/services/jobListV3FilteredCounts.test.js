import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assembleFilteredStatusCounts,
	bodyHasRestrictiveFilters,
	buildAlgoliaFacetFilters,
	buildAlgoliaNumericFilters,
	shouldUseAlgoliaList,
} from './jobListV3Service.js';

test('bodyHasRestrictiveFilters detects source and text filters', () => {
	assert.equal(bodyHasRestrictiveFilters({}), false);
	assert.equal(bodyHasRestrictiveFilters({ jobSources: 'Greenhouse' }), true);
	assert.equal(bodyHasRestrictiveFilters({ q: 'engineer' }), true);
	assert.equal(bodyHasRestrictiveFilters({ 'details.remote': 'Remote' }), true);
});

test('buildAlgoliaFacetFilters always includes APPROVED and optional source OR group', () => {
	assert.deepEqual(
		buildAlgoliaFacetFilters({}, null, { isBeta: true }),
		[['titleReviewLabel:APPROVED']],
	);
	assert.deepEqual(
		buildAlgoliaFacetFilters({}, ['Greenhouse', 'Ashby'], { isBeta: true }),
		[['titleReviewLabel:APPROVED'], ['source:Greenhouse', 'source:Ashby']],
	);
	const nonBeta = buildAlgoliaFacetFilters(
		{ 'details.remote': 'Remote', aiExtracted: true, companyId: 'co1' },
		['Greenhouse'],
		{ isBeta: false },
	);
	assert.ok(nonBeta.some((entry) => entry === 'extensionV2:false'));
	assert.ok(nonBeta.some((entry) => entry === 'remote:Remote'));
	assert.ok(nonBeta.some((entry) => entry === 'aiSkillStatus:extracted'));
	assert.ok(nonBeta.some((entry) => entry === 'companyId:co1'));
	assert.ok(nonBeta.some((entry) => Array.isArray(entry) && entry.includes('source:Greenhouse')));
});

test('buildAlgoliaNumericFilters encodes postedAt ranges', () => {
	const filters = buildAlgoliaNumericFilters({
		postedAtFrom: '2026-01-01',
		postedAtTo: '2026-01-31',
	});
	assert.equal(filters.length, 2);
	assert.match(filters[0], /^postedAtMs>=/);
	assert.match(filters[1], /^postedAtMs<=/);
});

test('assembleFilteredStatusCounts uses All from index and New = all - any', () => {
	const counts = assembleFilteredStatusCounts(1000, {
		'bid-ready': 10,
		'bid-completed': 5,
		applied: 20,
		scheduled: 3,
		declined: 2,
	});
	assert.equal(counts.all, 1000);
	assert.equal(counts.posted, 1000 - 40);
	assert.equal(counts.applied, 20);
	assert.equal(counts['bid-ready'], 10);
});

test('assembleFilteredStatusCounts falls back to status any when All is unknown', () => {
	const counts = assembleFilteredStatusCounts(null, { applied: 4, scheduled: 1 });
	assert.equal(counts.all, 5);
	assert.equal(counts.posted, 0);
	assert.equal(counts.applied, 4);
});

test('source-only All/New uses native list, not Algolia browse', () => {
	assert.equal(shouldUseAlgoliaList({ jobSources: 'Greenhouse' }, 'all'), false);
	assert.equal(shouldUseAlgoliaList({ jobSources: 'Greenhouse' }, 'new'), false);
});

test('text search still requires Algolia list path', () => {
	assert.equal(shouldUseAlgoliaList({ q: 'engineer', jobSources: 'Greenhouse' }, 'all'), true);
});

test('multi exact facets require Algolia list path', () => {
	assert.equal(
		shouldUseAlgoliaList({ jobSources: 'Greenhouse', 'details.remote': 'Remote' }, 'all'),
		true,
	);
});

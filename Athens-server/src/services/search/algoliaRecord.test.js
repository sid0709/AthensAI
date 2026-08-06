import assert from 'node:assert/strict';
import test from 'node:test';
import { record } from './algoliaJobs.js';

test('algolia record includes facet fields for filtered Job Search', () => {
	const row = record('job1', {
		title: 'Engineer',
		company: { name: 'Acme' },
		source: 'Greenhouse',
		sourceCatalog: 'market',
		postedAt: '2026-01-15T00:00:00.000Z',
		titleReview: { label: 'APPROVED' },
		companyId: 'co1',
		aiSkillStatus: 'extracted',
		extensionV2: false,
		details: {
			remote: 'Remote',
			seniority: 'Senior',
			time: 'Full-Time',
			position: 'United States',
		},
	});
	assert.equal(row.objectID, 'job1');
	assert.equal(row.titleReviewLabel, 'APPROVED');
	assert.equal(row.source, 'Greenhouse');
	assert.equal(row.remote, 'Remote');
	assert.equal(row.seniority, 'Senior');
	assert.equal(row.time, 'Full-Time');
	assert.equal(row.position, 'United States');
	assert.equal(row.companyId, 'co1');
	assert.equal(row.aiSkillStatus, 'extracted');
	assert.equal(row.extensionV2, false);
	assert.equal(row.postedAtMs, Date.parse('2026-01-15T00:00:00.000Z'));
});

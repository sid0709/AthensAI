import assert from 'node:assert/strict';
import test from 'node:test';

import {
	getJobValidationChecklist,
	getJobValidationIssues,
	mergeJobValidationChecklist,
} from './jobValidation.js';

const completeJob = {
	applyLink: 'https://example.com/apply',
	id: 123,
	duplicateWindowDays: 14,
	postedAgo: '2 hours ago',
	title: 'Software Engineer',
	tags: ['20 applicants'],
	description: 'Build and maintain software.',
	companyLink: 'https://example.com/company',
	details: { Location: 'Remote' },
	skills: ['JavaScript'],
	company: {
		name: 'Example Co',
		logo: 'https://example.com/logo.png',
		tags: ['Technology'],
	},
};

test('reports pending checklist items until their scrape steps complete', () => {
	const checklist = getJobValidationChecklist(
		{ title: completeJob.title, postedAgo: '' },
		['title', 'postedAgo'],
	);

	assert.equal(checklist.find(({ id }) => id === 'title').status, 'valid');
	assert.equal(checklist.find(({ id }) => id === 'postedAgo').status, 'invalid');
	assert.equal(checklist.find(({ id }) => id === 'skills').status, 'pending');
});

test('uses the same rules for the final payload audit', () => {
	assert.deepEqual(getJobValidationIssues(completeJob), []);
	assert.deepEqual(
		getJobValidationIssues({ ...completeJob, title: '', tags: null }),
		['Job title', 'Job tags'],
	);
});

test('accumulates completed checks without resetting earlier results', () => {
	let checklist = getJobValidationChecklist({}, []);
	checklist = mergeJobValidationChecklist(checklist, { title: completeJob.title }, ['title']);
	checklist = mergeJobValidationChecklist(checklist, { tags: completeJob.tags }, ['tags']);

	assert.equal(checklist.find(({ id }) => id === 'title').status, 'valid');
	assert.equal(checklist.find(({ id }) => id === 'tags').status, 'valid');
	assert.equal(checklist.find(({ id }) => id === 'postedAgo').status, 'pending');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBidQueueJobs } from './jobBidStatusService.js';

const PROFILE_ID = '64f000000000000000000001';
const READY_JOB_ID = '64f000000000000000000002';
const APPLIED_JOB_ID = '64f000000000000000000003';

test('maps Bid Ready jobs from migrated status projections without embedded job status', () => {
	const docs = [{
		_id: READY_JOB_ID,
		title: 'Senior Software Developer',
		company: { name: 'Guidehouse' },
		applyLink: 'https://example.test/jobs/ready',
		source: 'Workday',
		status: [],
	}];
	const projectedStatuses = new Map([[
		READY_JOB_ID,
		[{ applier: PROFILE_ID, bidReadyDate: '2026-07-21T18:48:46.000Z' }],
	]]);

	assert.deepEqual(
		mapBidQueueJobs([READY_JOB_ID], docs, projectedStatuses, PROFILE_ID),
		[{
			jobId: READY_JOB_ID,
			title: 'Senior Software Developer',
			company: 'Guidehouse',
			applyUrl: 'https://example.test/jobs/ready',
			source: 'Workday',
			bidReadyDate: '2026-07-21T18:48:46.000Z',
			bidCompletedDate: null,
			completed: false,
		}],
	);
});

test('does not leak a stale indexed ID after its projected status becomes applied', () => {
	const docs = [{ _id: APPLIED_JOB_ID, title: 'Applied job' }];
	const projectedStatuses = new Map([[
		APPLIED_JOB_ID,
		[{
			applier: PROFILE_ID,
			bidReadyDate: '2026-07-21T18:48:46.000Z',
			appliedDate: '2026-07-22T18:48:46.000Z',
		}],
	]]);

	assert.deepEqual(
		mapBidQueueJobs([APPLIED_JOB_ID], docs, projectedStatuses, PROFILE_ID),
		[],
	);
});

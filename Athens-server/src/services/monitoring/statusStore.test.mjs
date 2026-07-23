import test from 'node:test';
import assert from 'node:assert/strict';
import { markStaleComponent, overallStatus, summarizeLiveSamples } from './statusStore.js';

test('overall status prioritizes outages over degraded and unknown components', () => {
	assert.equal(overallStatus([{ status: 'operational' }, { status: 'unknown' }]), 'unknown');
	assert.equal(overallStatus([{ status: 'degraded' }, { status: 'unknown' }]), 'degraded');
	assert.equal(overallStatus([{ status: 'partial_outage' }, { status: 'degraded' }]), 'partial_outage');
	assert.equal(overallStatus([{ status: 'major_outage' }, { status: 'operational' }]), 'major_outage');
});

test('live samples are converted to percentages and downsampled', () => {
	const samples = [
		{ checkedAt: new Date('2026-07-23T12:00:00Z'), metrics: { cpuUtilization: 0.2, memoryUtilization: 0.7, diskUtilization: 0.8, loadRatio: 0.5, uptimeSeconds: 100 } },
		{ checkedAt: new Date('2026-07-23T12:00:30Z'), metrics: { cpuUtilization: 0.4, memoryUtilization: 0.8, diskUtilization: 0.82, loadRatio: 0.7, uptimeSeconds: 130 } },
	];
	assert.deepEqual(summarizeLiveSamples(samples, 1), [{
		timestamp: new Date('2026-07-23T12:00:30Z'),
		cpuPercent: 30,
		memoryPercent: 75,
		diskPercent: 81,
		loadPercent: 60,
		uptimeSeconds: 130,
	}]);
});

test('old component samples become unknown', () => {
	assert.deepEqual(markStaleComponent(
		{ status: 'operational', message: 'Operating normally.', lastCheckedAt: '2026-07-23T12:00:00Z' },
		new Date('2026-07-23T12:03:00Z').getTime(),
		120000,
	), { status: 'unknown', message: 'Monitoring data is stale.', lastCheckedAt: '2026-07-23T12:00:00Z' });
});

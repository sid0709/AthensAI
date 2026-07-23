import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodayTimelines, markStaleComponent, overallStatus, stabilizeStatus, summarizeLiveSamples } from './statusStore.js';

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

test('today timeline uses the worst status in each 15-minute bucket', () => {
	const now = new Date('2026-07-23T00:31:00Z');
	const grouped = [{
		_id: { component: 'athens-api', timestamp: new Date('2026-07-23T00:15:00Z') },
		statuses: ['operational', 'major_outage'],
		sampleCount: 30,
		successCount: 24,
	}];
	const timeline = buildTodayTimelines(grouped, now, 15);
	const api = timeline.components.find((component) => component.component === 'athens-api');
	assert.equal(api.segments.length, 3);
	assert.equal(api.segments[0].status, 'unknown');
	assert.equal(api.segments[1].status, 'major_outage');
	assert.equal(api.segments[1].availabilityPercent, 80);
});

test('a single missing scrape does not erase known health for an entire bucket', () => {
	const now = new Date('2026-07-23T00:16:00Z');
	const timeline = buildTodayTimelines([{
		_id: { component: 'vps', timestamp: new Date('2026-07-23T00:15:00Z') },
		statuses: ['operational', 'unknown'], sampleCount: 2, successCount: 1,
	}], now, 15);
	const vps = timeline.components.find((component) => component.component === 'vps');
	assert.equal(vps.segments[1].status, 'operational');
	assert.equal(vps.segments[1].availabilityPercent, 50);
});

test('status stabilization ignores brief warnings and requires sustained pressure', () => {
	const options = { warningSamples: 3, criticalSamples: 2, recoverySamples: 2 };
	const warning = { status: 'degraded', message: 'CPU 86%.' };
	const first = stabilizeStatus(warning, { status: 'operational', rawStatus: 'operational', statusStreak: 20 }, options);
	const second = stabilizeStatus(warning, { status: first.status, rawStatus: first.rawStatus, statusStreak: first.statusStreak }, options);
	const third = stabilizeStatus(warning, { status: second.status, rawStatus: second.rawStatus, statusStreak: second.statusStreak }, options);
	assert.equal(first.status, 'operational');
	assert.equal(second.status, 'operational');
	assert.equal(third.status, 'degraded');
});

test('critical state and recovery both require confirmation', () => {
	const options = { warningSamples: 3, criticalSamples: 2, recoverySamples: 2 };
	const critical = { status: 'major_outage', message: 'Disk 95%.' };
	const first = stabilizeStatus(critical, { status: 'operational', rawStatus: 'operational', statusStreak: 20 }, options);
	const second = stabilizeStatus(critical, { status: first.status, rawStatus: first.rawStatus, statusStreak: first.statusStreak }, options);
	const recovery = stabilizeStatus({ status: 'operational', message: 'Operating normally.' }, { status: second.status, rawStatus: second.rawStatus, statusStreak: second.statusStreak }, options);
	assert.equal(first.status, 'degraded');
	assert.equal(second.status, 'major_outage');
	assert.equal(recovery.status, 'major_outage');
});

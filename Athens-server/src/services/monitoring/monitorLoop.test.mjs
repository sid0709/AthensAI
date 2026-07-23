import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCpuUtilization, isMonitoringEnabled } from './monitorLoop.js';

test('CPU utilization is calculated from consecutive snapshots', () => {
	assert.equal(calculateCpuUtilization(
		{ idle: 1_000, total: 2_000 },
		{ idle: 1_250, total: 3_000 },
	), 0.75);
});

test('CPU utilization returns null when no time elapsed', () => {
	assert.equal(calculateCpuUtilization(
		{ idle: 1_000, total: 2_000 },
		{ idle: 1_000, total: 2_000 },
	), null);
});

test('monitoring defaults to production only and supports an explicit override', () => {
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'development' }), false);
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'production' }), true);
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'production', MONITORING_ENABLED: 'false' }), false);
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'development', MONITORING_ENABLED: 'true' }), true);
});

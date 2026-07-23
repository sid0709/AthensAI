import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVpsMetrics, isMonitoringEnabled } from './monitorLoop.js';

test('VPS resource pressure degrades health but does not claim the host is offline', () => {
	assert.equal(classifyVpsMetrics({ cpuUtilization: 0.3, memoryUtilization: 0.6, diskUtilization: 0.7, loadRatio: 0.2 }).status, 'operational');
	assert.equal(classifyVpsMetrics({ cpuUtilization: 0.86, memoryUtilization: 0.6, diskUtilization: 0.7, loadRatio: 0.2 }).status, 'degraded');
	assert.equal(classifyVpsMetrics({ cpuUtilization: 0.96, memoryUtilization: 0.6, diskUtilization: 0.7, loadRatio: 0.2 }).status, 'degraded');
	assert.match(classifyVpsMetrics({ cpuUtilization: 0.96, memoryUtilization: 0.6, diskUtilization: 0.7, loadRatio: 0.2 }).message, /Critical resource pressure/);
});

test('VPS warning message identifies the metric that crossed its threshold', () => {
	assert.match(classifyVpsMetrics({ cpuUtilization: 0.3, memoryUtilization: 0.91, diskUtilization: 0.7, loadRatio: 0.2 }).message, /memory 91%/);
});

test('monitoring defaults to production only and supports an explicit override', () => {
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'development' }), false);
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'production' }), true);
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'production', MONITORING_ENABLED: 'false' }), false);
	assert.equal(isMonitoringEnabled({ NODE_ENV: 'development', MONITORING_ENABLED: 'true' }), true);
});

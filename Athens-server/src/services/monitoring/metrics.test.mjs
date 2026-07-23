import test from 'node:test';
import assert from 'node:assert/strict';
import { incrementCounter, renderMetrics, setGauge } from './metrics.js';

test('metrics exporter emits counters, gauges, and safe labels', () => {
	incrementCounter('test_counter_total', { route: '/api/status', status: '200' });
	setGauge('test_gauge', { component: 'athens-api' }, 1);
	const output = renderMetrics('test');
	assert.ok(output.includes('test_counter_total{route="/api/status",status="200"} 1'));
	assert.ok(output.includes('test_gauge{component="athens-api"} 1'));
});

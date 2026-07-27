import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMetricMessage, incrementCounter, renderMetrics, setGauge } from './metrics.js';

test('metrics exporter emits counters, gauges, and safe labels', () => {
	incrementCounter('test_counter_total', { route: '/api/status', status: '200' });
	setGauge('test_gauge', { component: 'athens-api' }, 1);
	const output = renderMetrics('test');
	assert.ok(output.includes('test_counter_total{route="/api/status",status="200"} 1'));
	assert.ok(output.includes('test_gauge{component="athens-api"} 1'));
});

test('cluster aggregation consumes metric deltas from multiple workers', () => {
	applyMetricMessage({ type: 'athens:metric', operation: 'counter', name: 'cluster_test_total', labels: { worker: 'all' }, value: 2 });
	applyMetricMessage({ type: 'athens:metric', operation: 'counter', name: 'cluster_test_total', labels: { worker: 'all' }, value: 3 });
	applyMetricMessage({ type: 'athens:metric', operation: 'gauge', name: 'cluster_test_gauge', labels: {}, value: 7 });
	const output = renderMetrics('cluster-test');
	assert.ok(output.includes('cluster_test_total{worker="all"} 5'));
	assert.ok(output.includes('cluster_test_gauge 7'));
});

test('metrics exporter declares each metric type only once across label sets', () => {
	incrementCounter('type_once_total', { status: '200' });
	incrementCounter('type_once_total', { status: '500' });
	const declarations = renderMetrics('type-test').split('\n').filter((line) => line === '# TYPE type_once_total counter');
	assert.equal(declarations.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPENDENCY_QUERIES, readPrometheusDailyRollup, readPrometheusVpsMetrics, VPS_QUERIES } from './prometheusClient.js';

function fakePrometheus(values) {
	return async (url) => {
		const expression = new URL(url).searchParams.get('query');
		const name = Object.entries(VPS_QUERIES).find(([, query]) => query === expression)?.[0];
		return {
			ok: true,
			json: async () => ({ status: 'success', data: { resultType: 'vector', result: [{ value: [1, String(values[name])] }] } }),
		};
	};
}

test('VPS metrics come from fixed Prometheus queries', async () => {
	const result = await readPrometheusVpsMetrics({
		baseUrl: 'http://prometheus:9090',
		fetchImpl: fakePrometheus({ cpuUtilization: 0.32, memoryUtilization: 0.68, diskUtilization: 0.71, loadRatio: 0.4, uptimeSeconds: 12345, scrapeAgeSeconds: 12 }),
	});
	assert.deepEqual(result, { cpuUtilization: 0.32, memoryUtilization: 0.68, diskUtilization: 0.71, loadRatio: 0.4, uptimeSeconds: 12345 });
});

test('stale node-exporter data is rejected instead of presented as live', async () => {
	await assert.rejects(() => readPrometheusVpsMetrics({
		fetchImpl: fakePrometheus({ cpuUtilization: 0.3, memoryUtilization: 0.6, diskUtilization: 0.7, loadRatio: 0.2, uptimeSeconds: 10, scrapeAgeSeconds: 180 }),
		maxScrapeAgeSeconds: 120,
	}), /stale/);
});

function fakeRange(sampleCount) {
	return async (url) => {
		const expression = new URL(url).searchParams.get('query');
		const value = expression === 'athens_health_severity' ? 0 : 1;
		return {
			ok: true,
			json: async () => ({
				status: 'success',
				data: { resultType: 'matrix', result: [{ metric: { component: 'firestore' }, values: Array.from({ length: sampleCount }, (_, index) => [index, String(value)]) }] },
			}),
		};
	};
}

test('daily rollups require at least 95 percent Prometheus coverage', async () => {
	const definitions = [{ id: 'firestore', name: 'Cloud Firestore' }];
	const complete = await readPrometheusDailyRollup(definitions, '2026-07-26', { fetchImpl: fakeRange(2736) });
	const incomplete = await readPrometheusDailyRollup(definitions, '2026-07-26', { fetchImpl: fakeRange(2735) });
	assert.equal(complete.complete, true);
	assert.equal(complete.components[0].coveragePercent, 95);
	assert.equal(incomplete.complete, false);
});

test('public dependency queries exclude inventory totals and user identifiers', () => {
	const serialized = JSON.stringify(DEPENDENCY_QUERIES);
	for (const forbidden of ['redis_db_keys', 'collections_vector_total', 'document_count', 'object_count', 'collection_name', 'key_name']) {
		assert.equal(serialized.includes(forbidden), false);
	}
});

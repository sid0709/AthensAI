import test from 'node:test';
import assert from 'node:assert/strict';
import { readPrometheusVpsMetrics, VPS_QUERIES } from './prometheusClient.js';

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

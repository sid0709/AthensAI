const DEFAULT_PROMETHEUS_URL = 'http://prometheus:9090';

const VPS_QUERIES = {
	cpuUtilization: 'max(athens:node_cpu_utilization:ratio)',
	memoryUtilization: 'max(athens:node_memory_utilization:ratio)',
	diskUtilization: 'max(athens:root_filesystem_utilization:ratio)',
	loadRatio: 'max(athens:node_load_utilization:ratio)',
	uptimeSeconds: 'max(athens:node_uptime_seconds)',
	scrapeAgeSeconds: 'time() - max(timestamp(node_uname_info))',
};

function metricValue(payload, metricName) {
	if (payload?.status !== 'success' || payload?.data?.resultType !== 'vector') {
		throw new Error(`Prometheus returned an invalid response for ${metricName}`);
	}
	const raw = payload.data.result?.[0]?.value?.[1];
	const value = Number(raw);
	if (!Number.isFinite(value)) throw new Error(`Prometheus has no current value for ${metricName}`);
	return value;
}

async function queryMetric(baseUrl, metricName, expression, fetchImpl) {
	const url = new URL('/api/v1/query', `${baseUrl.replace(/\/+$/, '')}/`);
	url.searchParams.set('query', expression);
	const response = await fetchImpl(url, {
		headers: { 'user-agent': 'athens-monitor/1.0' },
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error(`Prometheus query failed with HTTP ${response.status}`);
	return metricValue(await response.json(), metricName);
}

export async function readPrometheusVpsMetrics({
	baseUrl = process.env.PROMETHEUS_URL || DEFAULT_PROMETHEUS_URL,
	fetchImpl = fetch,
	maxScrapeAgeSeconds = Number(process.env.PROMETHEUS_MAX_SCRAPE_AGE_SECONDS || 120),
} = {}) {
	const entries = await Promise.all(Object.entries(VPS_QUERIES).map(async ([name, expression]) => [
		name,
		await queryMetric(baseUrl, name, expression, fetchImpl),
	]));
	const values = Object.fromEntries(entries);
	for (const name of ['cpuUtilization', 'memoryUtilization', 'diskUtilization']) {
		if (values[name] < 0 || values[name] > 1) throw new Error(`Prometheus returned an out-of-range value for ${name}`);
	}
	if (values.loadRatio < 0 || values.uptimeSeconds < 0 || values.scrapeAgeSeconds < 0) {
		throw new Error('Prometheus returned an invalid negative VPS metric');
	}
	if (values.scrapeAgeSeconds > maxScrapeAgeSeconds) {
		throw new Error(`Prometheus node-exporter data is stale (${Math.round(values.scrapeAgeSeconds)} seconds old)`);
	}
	delete values.scrapeAgeSeconds;
	return values;
}

export { VPS_QUERIES };

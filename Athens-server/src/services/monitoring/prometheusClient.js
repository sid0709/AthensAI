const DEFAULT_PROMETHEUS_URL = 'http://prometheus:9090';
const REQUEST_TIMEOUT_MS = 5000;

const VPS_QUERIES = {
	cpuUtilization: 'max(athens:node_cpu_utilization:ratio)',
	memoryUtilization: 'max(athens:node_memory_utilization:ratio)',
	diskUtilization: 'max(athens:root_filesystem_utilization:ratio)',
	loadRatio: 'max(athens:node_load_utilization:ratio)',
	uptimeSeconds: 'max(athens:node_uptime_seconds)',
	scrapeAgeSeconds: 'time() - max(timestamp(node_uname_info))',
};

const LIVE_VPS_QUERIES = Object.fromEntries(
	Object.entries(VPS_QUERIES).filter(([name]) => name !== 'scrapeAgeSeconds'),
);

export const DEPENDENCY_QUERIES = {
	redis: {
		memoryBytes: 'max(redis_memory_used_bytes)',
		rssBytes: 'max(redis_memory_used_rss_bytes)',
		clients: 'max(redis_connected_clients)',
		operationsPerSecond: 'sum(rate(redis_commands_processed_total[5m]))',
		hitRatePercent: '100 * sum(rate(redis_keyspace_hits_total[5m])) / clamp_min(sum(rate(redis_keyspace_hits_total[5m]) + rate(redis_keyspace_misses_total[5m])), 1)',
		evictionsPerSecond: 'sum(rate(redis_evicted_keys_total[5m]))',
	},
	qdrant: {
		requestsPerSecond: 'sum(rate(rest_responses_total[5m])) or vector(0)',
		errorRatePercent: '100 * (sum(rate(rest_responses_total{status=~"4..|5.."}[5m])) or vector(0)) / clamp_min((sum(rate(rest_responses_total[5m])) or vector(0)), 1)',
		p95LatencyMs: '1000 * histogram_quantile(0.95, sum by (le) (rate(rest_responses_duration_seconds_bucket[5m])))',
		memoryBytes: 'max(memory_active_bytes)',
	},
};

function baseUrl(value = process.env.PROMETHEUS_URL || DEFAULT_PROMETHEUS_URL) {
	return value.replace(/\/+$/, '');
}

async function prometheusRequest(path, params, { baseUrl: configuredBaseUrl, fetchImpl = fetch } = {}) {
	const url = new URL(path, `${baseUrl(configuredBaseUrl)}/`);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
	const response = await fetchImpl(url, {
		headers: { 'user-agent': 'athens-monitor/2.0' },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`Prometheus request failed with HTTP ${response.status}`);
	const payload = await response.json();
	if (payload?.status !== 'success') throw new Error(`Prometheus request failed: ${payload?.error || 'invalid response'}`);
	return payload.data;
}

export async function queryPrometheus(expression, options = {}) {
	return prometheusRequest('/api/v1/query', { query: expression }, options);
}

export async function queryPrometheusRange(expression, { start, end, step, ...options }) {
	return prometheusRequest('/api/v1/query_range', {
		query: expression,
		start: new Date(start).getTime() / 1000,
		end: new Date(end).getTime() / 1000,
		step,
	}, options);
}

function scalarVectorValue(data, metricName) {
	if (data?.resultType !== 'vector') throw new Error(`Prometheus returned an invalid response for ${metricName}`);
	const value = Number(data.result?.[0]?.value?.[1]);
	if (!Number.isFinite(value)) throw new Error(`Prometheus has no current value for ${metricName}`);
	return value;
}

function matrixSeries(data) {
	if (data?.resultType !== 'matrix') throw new Error('Prometheus returned an invalid range response');
	return data.result || [];
}

function stepForMinutes(minutes, maxPoints = 240) {
	return Math.max(30, Math.ceil((minutes * 60) / maxPoints));
}

export async function readPrometheusVpsMetrics({
	baseUrl: configuredBaseUrl = process.env.PROMETHEUS_URL || DEFAULT_PROMETHEUS_URL,
	fetchImpl = fetch,
	maxScrapeAgeSeconds = Number(process.env.PROMETHEUS_MAX_SCRAPE_AGE_SECONDS || 120),
} = {}) {
	const entries = await Promise.all(Object.entries(VPS_QUERIES).map(async ([name, expression]) => [
		name,
		scalarVectorValue(await queryPrometheus(expression, { baseUrl: configuredBaseUrl, fetchImpl }), name),
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

function vectorByLabel(data, label) {
	if (data?.resultType !== 'vector') throw new Error('Prometheus returned an invalid vector response');
	return new Map((data.result || []).flatMap((row) => {
		const id = row.metric?.[label];
		const value = Number(row.value?.[1]);
		return id && Number.isFinite(value) ? [[id, { value, metric: row.metric, timestamp: Number(row.value?.[0]) }]] : [];
	}));
}

export async function readPrometheusCurrentStatus(definitions, options = {}) {
	const [statesData, timestampsData, latencyData, uptimeData] = await Promise.all([
		queryPrometheus('athens_health_state == 1', options),
		queryPrometheus('athens_health_check_timestamp_seconds', options),
		queryPrometheus('athens_health_latency_ms', options),
		queryPrometheus('100 * avg_over_time(athens_health_status[24h])', options),
	]);
	if (statesData?.resultType !== 'vector') throw new Error('Prometheus returned an invalid component state response');
	const timestamps = vectorByLabel(timestampsData, 'component');
	const latencies = vectorByLabel(latencyData, 'component');
	const uptime = vectorByLabel(uptimeData, 'component');
	const stateRows = new Map((statesData.result || []).flatMap((row) => {
		const component = row.metric?.component;
		const status = row.metric?.status;
		return component && status ? [[component, status]] : [];
	}));
	const now = Date.now();
	const staleAfterMs = Number(process.env.MONITOR_STALE_AFTER_MS || 120000);
	return new Map(definitions.map((definition) => {
		const checkedSeconds = timestamps.get(definition.id)?.value;
		const checkedMs = Number(checkedSeconds) * 1000;
		const stale = !Number.isFinite(checkedMs) || now - checkedMs > staleAfterMs;
		return [definition.id, {
			component: definition.id,
			name: definition.name,
			status: stale ? 'unknown' : (stateRows.get(definition.id) || 'unknown'),
			lastCheckedAt: Number.isFinite(checkedMs) ? new Date(checkedMs) : null,
			latencyMs: latencies.get(definition.id)?.value ?? null,
			uptimePercent: uptime.get(definition.id)?.value ?? null,
		}];
	}));
}

function mergeRangeSeries(seriesByName, transforms = {}) {
	const points = new Map();
	for (const [name, series] of Object.entries(seriesByName)) {
		for (const [timestamp, raw] of series?.values || []) {
			const value = Number(raw);
			if (!Number.isFinite(value)) continue;
			const key = Number(timestamp);
			const point = points.get(key) || { timestamp: new Date(key * 1000).toISOString() };
			point[name] = transforms[name] ? transforms[name](value) : value;
			points.set(key, point);
		}
	}
	return [...points.entries()].sort(([left], [right]) => left - right).map(([, point]) => point);
}

export async function readPrometheusLiveMetrics(minutes = 60, options = {}) {
	const end = new Date();
	const start = new Date(end.getTime() - minutes * 60 * 1000);
	const step = stepForMinutes(minutes);
	const entries = await Promise.all(Object.entries(LIVE_VPS_QUERIES).map(async ([name, expression]) => {
		const data = await queryPrometheusRange(expression, { start, end, step, ...options });
		return [name, matrixSeries(data)[0] || null];
	}));
	return mergeRangeSeries(Object.fromEntries(entries), {
		cpuUtilization: (value) => Math.round(value * 1000) / 10,
		memoryUtilization: (value) => Math.round(value * 1000) / 10,
		diskUtilization: (value) => Math.round(value * 1000) / 10,
		loadRatio: (value) => Math.round(value * 1000) / 10,
	}).map((point) => ({
		timestamp: point.timestamp,
		cpuPercent: point.cpuUtilization ?? null,
		memoryPercent: point.memoryUtilization ?? null,
		diskPercent: point.diskUtilization ?? null,
		loadPercent: point.loadRatio ?? null,
		uptimeSeconds: point.uptimeSeconds ?? null,
	}));
}

const SEVERITY_STATUS = ['operational', 'degraded', 'partial_outage', 'major_outage', 'unknown'];

function healthRangeByComponent(severityData, availabilityData) {
	const result = new Map();
	for (const series of matrixSeries(severityData)) {
		const component = series.metric?.component;
		if (!component) continue;
		const item = result.get(component) || { severity: new Map(), availability: new Map() };
		for (const [timestamp, raw] of series.values || []) item.severity.set(Number(timestamp), Number(raw));
		result.set(component, item);
	}
	for (const series of matrixSeries(availabilityData)) {
		const component = series.metric?.component;
		if (!component) continue;
		const item = result.get(component) || { severity: new Map(), availability: new Map() };
		for (const [timestamp, raw] of series.values || []) item.availability.set(Number(timestamp), Number(raw));
		result.set(component, item);
	}
	return result;
}

export async function readPrometheusTodayTimeline(definitions, now = new Date(), bucketMinutes = 15, options = {}) {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const [severityData, availabilityData] = await Promise.all([
		queryPrometheusRange('athens_health_severity', { start, end: now, step: 30, ...options }),
		queryPrometheusRange('athens_health_status', { start, end: now, step: 30, ...options }),
	]);
	const source = healthRangeByComponent(severityData, availabilityData);
	const bucketSeconds = bucketMinutes * 60;
	const slotCount = Math.floor((now.getTime() - start.getTime()) / (bucketSeconds * 1000)) + 1;
	const components = definitions.map((definition) => {
		const series = source.get(definition.id);
		return {
			component: definition.id,
			name: definition.name,
			segments: Array.from({ length: slotCount }, (_, index) => {
				const timestamp = new Date(start.getTime() + index * bucketSeconds * 1000);
				const lower = timestamp.getTime() / 1000;
				const upper = lower + bucketSeconds;
				const severityValues = [...(series?.severity.entries() || [])].filter(([time]) => time >= lower && time < upper).map(([, value]) => value);
				const known = severityValues.filter((value) => value < 4);
				const worst = known.length ? Math.max(...known) : (severityValues.length ? 4 : null);
				const availabilityValues = [...(series?.availability.entries() || [])].filter(([time]) => time >= lower && time < upper).map(([, value]) => value);
				return {
					timestamp,
					status: worst == null ? 'unknown' : (SEVERITY_STATUS[Math.round(worst)] || 'unknown'),
					availabilityPercent: availabilityValues.length ? 100 * availabilityValues.reduce((sum, value) => sum + value, 0) / availabilityValues.length : null,
					sampleCount: availabilityValues.length,
				};
			}),
		};
	});
	return { startAt: start, endAt: now, bucketMinutes, components };
}

export async function readPrometheusDailyRollup(definitions, dateKey, options = {}) {
	const start = new Date(`${dateKey}T00:00:00.000Z`);
	const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
	const step = 30;
	const expectedSamples = 24 * 60 * 2;
	const [severityData, availabilityData] = await Promise.all([
		queryPrometheusRange('athens_health_severity', { start, end, step, ...options }),
		queryPrometheusRange('athens_health_status', { start, end, step, ...options }),
	]);
	const source = healthRangeByComponent(severityData, availabilityData);
	const components = definitions.map((definition) => {
		const series = source.get(definition.id);
		const availability = [...(series?.availability.values() || [])].filter(Number.isFinite);
		const severity = [...(series?.severity.values() || [])].filter(Number.isFinite);
		const coveragePercent = Math.min(100, 100 * availability.length / expectedSamples);
		const knownSeverity = severity.filter((value) => value < 4);
		const worst = knownSeverity.length ? Math.max(...knownSeverity) : (severity.length ? 4 : null);
		return {
			component: definition.id,
			name: definition.name,
			sampleCount: availability.length,
			successCount: availability.filter((value) => value >= 0.5).length,
			availabilityPercent: availability.length ? 100 * availability.reduce((sum, value) => sum + value, 0) / availability.length : null,
			healthStatus: worst == null ? 'unknown' : (SEVERITY_STATUS[Math.round(worst)] || 'unknown'),
			coveragePercent,
		};
	});
	return { date: dateKey, complete: components.every((item) => item.coveragePercent >= 95), components };
}

async function readDependencySeries(queries, minutes, options) {
	const end = new Date();
	const start = new Date(end.getTime() - minutes * 60 * 1000);
	const step = stepForMinutes(minutes, 180);
	const entries = await Promise.all(Object.entries(queries).map(async ([name, expression]) => {
		const data = await queryPrometheusRange(expression, { start, end, step, ...options });
		return [name, matrixSeries(data)[0] || null];
	}));
	return mergeRangeSeries(Object.fromEntries(entries));
}

export async function readPrometheusDependencyMetrics(minutes = 60, options = {}) {
	const entries = await Promise.all(Object.entries(DEPENDENCY_QUERIES).map(async ([dependency, queries]) => {
		const points = await readDependencySeries(queries, minutes, options);
		return [dependency, {
			updatedAt: points.at(-1)?.timestamp || null,
			current: points.at(-1) || null,
			points,
			source: 'prometheus',
			delayed: false,
			expectedDelaySeconds: 0,
		}];
	}));
	return Object.fromEntries(entries);
}

export { VPS_QUERIES, stepForMinutes };

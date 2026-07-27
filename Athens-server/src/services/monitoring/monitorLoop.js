import { setGauge, setHealthMetric, setHealthStateMetrics } from './metrics.js';
import { prepareStatusResults, recordChecks, rollupDay } from './statusStore.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { getQdrantApiKey, getQdrantUrl } from '../../config/graphAndVectorConfig.js';
import { readPrometheusVpsMetrics } from './prometheusClient.js';

const httpChecks = [
	{ component: 'athens-web', name: 'Athens web application', failureStatus: 'major_outage', url: () => `http://127.0.0.1:${process.env.PUBLIC_PORT || (process.env.NODE_ENV === 'production' ? 80 : 9030)}/` },
	{ component: 'athens-api', name: 'Athens API', failureStatus: 'major_outage', url: () => `http://127.0.0.1:${process.env.PORT || 8979}/readyz` },
	{ component: 'ai-bff', name: 'AI services', failureStatus: 'partial_outage', url: () => `http://127.0.0.1:${process.env.AI_BFF_PORT || 3920}/health` },
	{ component: 'avalon-relay', name: 'Avalon relay', failureStatus: 'partial_outage', url: () => `http://127.0.0.1:${process.env.AVALON_PORT || 3847}/avalon/health` },
	{ component: 'public-api', name: 'Public API request path', failureStatus: 'major_outage', url: () => process.env.PUBLIC_STATUS_CHECK_URL || `http://127.0.0.1:${process.env.PUBLIC_PORT || (process.env.NODE_ENV === 'production' ? 80 : 8979)}/api/status/current` },
];

let previousResults = new Map();

export function isMonitoringEnabled(env = process.env) {
	if (env.MONITORING_ENABLED != null) return String(env.MONITORING_ENABLED).toLowerCase() === 'true';
	return env.NODE_ENV === 'production';
}

function failed(check, started, error, message) {
	return {
		component: check.component,
		name: check.name,
		ok: false,
		latencyMs: Math.round(performance.now() - started),
		status: check.failureStatus,
		message,
		error: error instanceof Error ? error.message : String(error),
	};
}

async function checkHttp(check) {
	const started = performance.now();
	try {
		const response = await fetch(check.url(), { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'athens-monitor/2.0' } });
		const latencyMs = Math.round(performance.now() - started);
		const ok = response.status >= 200 && response.status < 300;
		return {
			component: check.component,
			name: check.name,
			ok,
			latencyMs,
			status: ok ? 'operational' : check.failureStatus,
			message: ok ? 'Operating normally.' : `Health check returned HTTP ${response.status}.`,
		};
	} catch (error) {
		return failed(check, started, error, 'Health check could not reach the service.');
	}
}

async function checkRedis() {
	const check = { component: 'redis', name: 'Redis cache', failureStatus: 'degraded' };
	const started = performance.now();
	try {
		if (!isRedisReady()) throw new Error('Redis client is not ready');
		if (await getRedis().ping() !== 'PONG') throw new Error('Redis ping returned an unexpected response');
		return { ...check, ok: true, latencyMs: Math.round(performance.now() - started), status: 'operational', message: 'Operating normally.' };
	} catch (error) {
		return failed(check, started, error, 'Redis is unavailable; cache and ranking fallbacks are active.');
	}
}

async function checkQdrant() {
	const check = { component: 'qdrant', name: 'Qdrant vector search', failureStatus: 'degraded' };
	const started = performance.now();
	try {
		const configured = getQdrantUrl();
		if (!configured) throw new Error('QDRANT_URL is not configured');
		const headers = getQdrantApiKey() ? { 'api-key': getQdrantApiKey() } : {};
		const response = await fetch(`${configured.replace(/\/+$/, '')}/readyz`, { headers, signal: AbortSignal.timeout(5000) });
		if (!response.ok) throw new Error(`Qdrant readiness returned HTTP ${response.status}`);
		return { ...check, ok: true, latencyMs: Math.round(performance.now() - started), status: 'operational', message: 'Operating normally.' };
	} catch (error) {
		return failed(check, started, error, 'Qdrant is unavailable; vector-search fallbacks are active.');
	}
}

export function classifyVpsMetrics(metrics) {
	const critical = metrics.diskUtilization >= 0.9 || metrics.memoryUtilization >= 0.95 || metrics.cpuUtilization >= 0.95 || metrics.loadRatio >= 1.5;
	const warning = metrics.diskUtilization >= 0.85 || metrics.memoryUtilization >= 0.9 || metrics.cpuUtilization >= 0.85 || metrics.loadRatio >= 1;
	const warnings = [];
	if (metrics.diskUtilization >= 0.85) warnings.push(`disk ${(metrics.diskUtilization * 100).toFixed(0)}%`);
	if (metrics.memoryUtilization >= 0.9) warnings.push(`memory ${(metrics.memoryUtilization * 100).toFixed(0)}%`);
	if (metrics.cpuUtilization >= 0.85) warnings.push(`CPU ${(metrics.cpuUtilization * 100).toFixed(0)}%`);
	if (metrics.loadRatio >= 1) warnings.push(`load per core ${(metrics.loadRatio * 100).toFixed(0)}%`);
	return {
		status: critical || warning ? 'degraded' : 'operational',
		message: warnings.length ? `${critical ? 'Critical' : 'Sustained'} resource pressure: ${warnings.join(', ')}.` : 'Operating normally.',
	};
}

async function checkVps() {
	const started = performance.now();
	try {
		const metrics = await readPrometheusVpsMetrics();
		const health = classifyVpsMetrics(metrics);
		return { component: 'vps', name: 'VPS infrastructure', ok: true, latencyMs: Math.round(performance.now() - started), ...health, metrics };
	} catch (error) {
		return { component: 'vps', name: 'VPS infrastructure', ok: false, latencyMs: Math.round(performance.now() - started), status: 'unknown', message: 'Infrastructure metrics are unavailable.', error: error instanceof Error ? error.message : String(error) };
	}
}

function emitResultMetrics(result, checkedAt) {
	setHealthMetric(result.component, result.ok);
	setHealthStateMetrics(result.component, result.status, checkedAt);
	if (result.latencyMs != null) setGauge('athens_health_latency_ms', { component: result.component }, result.latencyMs);
	if (!result.metrics) return;
	const metrics = result.metrics;
	if (Number.isFinite(metrics.cpuUtilization)) setGauge('athens_vps_cpu_utilization_ratio', {}, metrics.cpuUtilization);
	if (Number.isFinite(metrics.diskUtilization)) setGauge('athens_vps_disk_utilization_ratio', {}, metrics.diskUtilization);
	if (Number.isFinite(metrics.memoryUtilization)) setGauge('athens_vps_memory_utilization_ratio', {}, metrics.memoryUtilization);
	if (Number.isFinite(metrics.loadRatio)) setGauge('athens_vps_load_ratio', {}, metrics.loadRatio);
	if (Number.isFinite(metrics.uptimeSeconds)) setGauge('athens_vps_uptime_seconds', {}, metrics.uptimeSeconds);
}

export async function runMonitoringCycle() {
	const checkedAt = new Date();
	const rawResults = await Promise.all([
		...httpChecks.map(checkHttp),
		checkRedis(),
		checkQdrant(),
		checkVps(),
	]);
	const results = prepareStatusResults(rawResults, previousResults);
	previousResults = new Map(results.map((result) => [result.component, result]));

	// Prometheus collects only VPS-local signals. The existing application
	// Firebase identity persists the compact result snapshot for public fallback.
	for (const result of results) emitResultMetrics(result, checkedAt);
	setGauge('athens_monitor_cycle_timestamp_seconds', {}, checkedAt.getTime() / 1000);

	try {
		await recordChecks(results, { now: checkedAt });
		setGauge('athens_monitor_persistence_success', {}, 1);
		setGauge('athens_monitor_persistence_timestamp_seconds', {}, Date.now() / 1000);
	} catch (error) {
		setGauge('athens_monitor_persistence_success', {}, 0);
		console.warn('[monitoring] Firestore v2 snapshot write failed:', error instanceof Error ? error.message : error);
	}
	return results;
}

export function startMonitoringLoop() {
	if (!isMonitoringEnabled()) {
		console.log('[monitoring] production monitoring loop is disabled in this environment');
		return () => {};
	}
	let stopped = false;
	const tick = async () => {
		if (stopped) return;
		try {
			await runMonitoringCycle();
			await rollupDay(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
		} catch (error) {
			console.warn('[monitoring] cycle failed:', error instanceof Error ? error.message : error);
		}
		if (!stopped) setTimeout(() => void tick(), Number(process.env.MONITOR_INTERVAL_MS || 30000)).unref?.();
	};
	void tick();
	return () => { stopped = true; };
}

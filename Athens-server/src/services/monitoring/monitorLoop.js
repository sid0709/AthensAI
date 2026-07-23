import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { setGauge, setHealthMetric } from './metrics.js';
import { cleanupSamples, recordCheck, rollupDay } from './statusStore.js';
import { getMongoDb } from '../../db/mongo.js';

const checks = [
	{ component: 'athens-web', name: 'Athens web application', url: () => `http://127.0.0.1:${process.env.PUBLIC_PORT || (process.env.NODE_ENV === 'production' ? 80 : 9030)}/` },
	{ component: 'athens-api', name: 'Athens API', url: () => `http://127.0.0.1:${process.env.PORT || 8979}/readyz` },
	{ component: 'ai-bff', name: 'AI services', url: () => `http://127.0.0.1:${process.env.AI_BFF_PORT || 3920}/health` },
	{ component: 'avalon-relay', name: 'Avalon relay', url: () => `http://127.0.0.1:${process.env.AVALON_PORT || 3847}/avalon/health` },
	{ component: 'public-api', name: 'Public API request path', url: () => process.env.PUBLIC_STATUS_CHECK_URL || `http://127.0.0.1:${process.env.PUBLIC_PORT || (process.env.NODE_ENV === 'production' ? 80 : 8979)}/api/status/current` },
];

let previousCpuTimes = null;

function readCpuTimes() {
	return os.cpus().reduce((totals, cpu) => {
		const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
		return { idle: totals.idle + cpu.times.idle, total: totals.total + total };
	}, { idle: 0, total: 0 });
}

export function calculateCpuUtilization(previous, current) {
	if (!current || current.total <= 0) return null;
	const idle = previous ? current.idle - previous.idle : current.idle;
	const total = previous ? current.total - previous.total : current.total;
	if (total <= 0) return null;
	return Math.min(Math.max(1 - (idle / total), 0), 1);
}

export function isMonitoringEnabled(env = process.env) {
	if (env.MONITORING_ENABLED != null) return String(env.MONITORING_ENABLED).toLowerCase() === 'true';
	return env.NODE_ENV === 'production';
}

async function checkHttp(check) {
	const started = performance.now();
	try {
		const response = await fetch(check.url(), { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'athens-monitor/1.0' } });
		const latencyMs = Math.round(performance.now() - started);
		const ok = response.status >= 200 && response.status < 300;
		return { component: check.component, name: check.name, ok, latencyMs, status: ok ? 'operational' : 'major_outage', message: ok ? 'Operating normally.' : `Health check returned HTTP ${response.status}.` };
	} catch (error) {
		return { component: check.component, name: check.name, ok: false, latencyMs: Math.round(performance.now() - started), status: 'major_outage', message: 'Health check could not reach the service.', error: error instanceof Error ? error.message : String(error) };
	}
}

async function checkMongo() {
	const started = performance.now();
	try {
		const db = getMongoDb();
		if (!db) throw new Error('database handle unavailable');
		await db.command({ ping: 1 });
		return { component: 'mongodb', name: 'MongoDB', ok: true, latencyMs: Math.round(performance.now() - started), status: 'operational', message: 'Operating normally.' };
	} catch (error) {
		return { component: 'mongodb', name: 'MongoDB', ok: false, latencyMs: Math.round(performance.now() - started), status: 'major_outage', message: 'Database health check failed.', error: error instanceof Error ? error.message : String(error) };
	}
}

async function checkVps() {
	const started = performance.now();
	try {
		const filesystem = await statfs('/');
		const cpuTimes = readCpuTimes();
		const cpuUtilization = calculateCpuUtilization(previousCpuTimes, cpuTimes);
		previousCpuTimes = cpuTimes;
		const diskRatio = 1 - (Number(filesystem.bavail) / Number(filesystem.blocks || 1));
		const memoryRatio = 1 - (os.freemem() / os.totalmem());
		const loadRatio = os.loadavg()[0] / Math.max(os.cpus().length, 1);
		const status = diskRatio > 0.9 || memoryRatio > 0.95
			? 'major_outage'
			: diskRatio > 0.75 || memoryRatio > 0.9 || loadRatio > 1.5 || (cpuUtilization ?? 0) > 0.9
				? 'degraded'
				: 'operational';
		const warnings = [];
		if (diskRatio > 0.75) warnings.push(`disk ${(diskRatio * 100).toFixed(0)}%`);
		if (memoryRatio > 0.9) warnings.push(`memory ${(memoryRatio * 100).toFixed(0)}%`);
		if ((cpuUtilization ?? 0) > 0.9) warnings.push(`CPU ${(cpuUtilization * 100).toFixed(0)}%`);
		if (loadRatio > 1.5) warnings.push('CPU load is elevated');
		return {
			component: 'vps',
			name: 'VPS infrastructure',
			ok: status !== 'major_outage',
			latencyMs: Math.round(performance.now() - started),
			status,
			message: warnings.length ? `Resource warning: ${warnings.join(', ')}.` : 'Operating normally.',
			metrics: {
				cpuUtilization,
				diskUtilization: diskRatio,
				memoryUtilization: memoryRatio,
				loadRatio,
				uptimeSeconds: os.uptime(),
			},
		};
	} catch (error) {
		return { component: 'vps', name: 'VPS infrastructure', ok: false, latencyMs: Math.round(performance.now() - started), status: 'unknown', message: 'Infrastructure metrics are unavailable.', error: error instanceof Error ? error.message : String(error) };
	}
}

async function runOnce() {
	const results = await Promise.all([...checks.map(checkHttp), checkMongo(), checkVps()]);
	for (const result of results) {
		setHealthMetric(result.component, result.ok);
		if (result.latencyMs != null) setGauge('athens_health_latency_ms', { component: result.component }, result.latencyMs);
		if (result.metrics) {
			if (result.metrics.cpuUtilization != null) setGauge('athens_vps_cpu_utilization_ratio', {}, result.metrics.cpuUtilization);
			setGauge('athens_vps_disk_utilization_ratio', {}, result.metrics.diskUtilization);
			setGauge('athens_vps_memory_utilization_ratio', {}, result.metrics.memoryUtilization);
			setGauge('athens_vps_load_ratio', {}, result.metrics.loadRatio);
			setGauge('athens_vps_uptime_seconds', {}, result.metrics.uptimeSeconds);
		}
		await recordCheck(result);
	}
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
			await runOnce();
			await rollupDay(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
			await cleanupSamples();
		} catch (error) { console.warn('[monitoring] cycle failed:', error instanceof Error ? error.message : error); }
		if (!stopped) setTimeout(() => void tick(), Number(process.env.MONITOR_INTERVAL_MS || 30000)).unref?.();
	};
	void tick();
	return () => { stopped = true; };
}

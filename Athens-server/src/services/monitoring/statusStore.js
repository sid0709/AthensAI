import { getMongoDb } from '../../db/mongo.js';

export const STATUS_SOURCE = 'production';

const LEGACY_COMPONENTS = [
	{ id: 'athens-web', name: 'Athens web application' },
	{ id: 'athens-api', name: 'Athens API' },
	{ id: 'ai-bff', name: 'AI services' },
	{ id: 'avalon-relay', name: 'Avalon relay' },
	{ id: 'mongodb', name: 'MongoDB' },
	{ id: 'vps', name: 'VPS infrastructure' },
	{ id: 'public-api', name: 'Public API request path' },
];

const FIREBASE_COMPONENTS = [
	{ id: 'athens-web', name: 'Athens web application' },
	{ id: 'athens-api', name: 'Athens API' },
	{ id: 'ai-bff', name: 'AI services' },
	{ id: 'avalon-relay', name: 'Avalon relay' },
	{ id: 'firestore', name: 'Cloud Firestore' },
	{ id: 'storage', name: 'Cloud Storage' },
	{ id: 'public-api', name: 'Public API request path' },
];

function components() {
	return String(process.env.DATABASE_BACKEND || '').toLowerCase() === 'firestore' ? FIREBASE_COMPONENTS : LEGACY_COMPONENTS;
}

function collection(name) { return getMongoDb()?.collection(name) || null; }
export function getComponentDefinitions() { return components(); }

export function markStaleComponent(component, now = Date.now(), staleAfterMs = Number(process.env.MONITOR_STALE_AFTER_MS || 120000)) {
	const checkedAt = component?.lastCheckedAt ? new Date(component.lastCheckedAt).getTime() : 0;
	if (!checkedAt || now - checkedAt <= staleAfterMs) return component;
	return { ...component, status: 'unknown', message: 'Monitoring data is stale.' };
}

export async function readCurrentStatus() {
	const current = collection('monitor_current_status');
	const docs = current ? await current.find({ source: STATUS_SOURCE }, { projection: {
		_id: 0,
		component: 1,
		name: 1,
		status: 1,
		message: 1,
		lastCheckedAt: 1,
		lastSuccessAt: 1,
		latencyMs: 1,
		uptimePercent: 1,
	} }).sort({ component: 1 }).toArray() : [];
	const byId = new Map(docs.map((doc) => [doc.component, doc]));
	return components().map((component) => markStaleComponent(byId.get(component.id)) || {
		component: component.id, name: component.name, status: 'unknown', message: 'No monitoring sample is available yet.',
		lastCheckedAt: null, lastSuccessAt: null, latencyMs: null, uptimePercent: null,
	});
}

function averageMetric(items, name) {
	const values = items.map((item) => item.metrics?.[name]).filter((value) => Number.isFinite(value));
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizeLiveSamples(samples, maxPoints = 240) {
	if (!samples.length) return [];
	const bucketSize = Math.max(Math.ceil(samples.length / maxPoints), 1);
	const points = [];
	for (let index = 0; index < samples.length; index += bucketSize) {
		const bucket = samples.slice(index, index + bucketSize);
		const latest = bucket[bucket.length - 1];
		points.push({
			timestamp: latest.checkedAt,
			cpuPercent: toPercent(averageMetric(bucket, 'cpuUtilization')),
			memoryPercent: toPercent(averageMetric(bucket, 'memoryUtilization')),
			diskPercent: toPercent(averageMetric(bucket, 'diskUtilization')),
			loadPercent: toPercent(averageMetric(bucket, 'loadRatio')),
			uptimeSeconds: latest.metrics?.uptimeSeconds ?? null,
		});
	}
	return points;
}

function toPercent(value) {
	return value == null ? null : Math.round(value * 1000) / 10;
}

export async function readLiveMetrics(minutes = 60) {
	if (String(process.env.DATABASE_BACKEND || '').toLowerCase() === 'firestore') return [];
	const samples = collection('monitor_samples');
	if (!samples) return [];
	const from = new Date(Date.now() - minutes * 60 * 1000);
	const docs = await samples.find(
		{ source: STATUS_SOURCE, component: 'vps', checkedAt: { $gte: from }, 'metrics.cpuUtilization': { $type: 'number' } },
		{ projection: { _id: 0, checkedAt: 1, metrics: 1 } },
	).sort({ checkedAt: 1 }).toArray();
	return summarizeLiveSamples(docs);
}

const STATUS_PRIORITY = {
	operational: 0,
	unknown: 1,
	maintenance: 2,
	degraded: 3,
	partial_outage: 4,
	major_outage: 5,
};

function worstStatus(statuses = []) {
	const known = statuses.filter((status) => status !== 'unknown');
	if (!known.length) return 'unknown';
	return known.reduce((worst, status) => (STATUS_PRIORITY[status] ?? 1) > (STATUS_PRIORITY[worst] ?? 1) ? status : worst, 'operational');
}

export function buildTodayTimelines(grouped, now = new Date(), bucketMinutes = 15) {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const bucketMs = bucketMinutes * 60 * 1000;
	const slotCount = Math.floor((now.getTime() - start.getTime()) / bucketMs) + 1;
	const bySlot = new Map(grouped.map((item) => [
		`${item._id.component}:${new Date(item._id.timestamp).getTime()}`,
		item,
	]));
	const components = getComponentDefinitions().map((component) => ({
		component: component.id,
		name: component.name,
		segments: Array.from({ length: slotCount }, (_, index) => {
			const timestamp = new Date(start.getTime() + index * bucketMs);
			const item = bySlot.get(`${component.id}:${timestamp.getTime()}`);
			return {
				timestamp,
				status: item ? worstStatus(item.statuses) : 'unknown',
				availabilityPercent: item?.sampleCount ? (item.successCount / item.sampleCount) * 100 : null,
				sampleCount: item?.sampleCount || 0,
			};
		}),
	}));
	return { startAt: start, endAt: now, bucketMinutes, components };
}

export async function readTodayTimelines(now = new Date(), bucketMinutes = 15) {
	const samples = collection('monitor_samples');
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	if (!samples) return buildTodayTimelines([], now, bucketMinutes);
	const grouped = await samples.aggregate([
		{ $match: { source: STATUS_SOURCE, checkedAt: { $gte: start, $lte: now } } },
		{ $project: {
			component: 1,
			status: 1,
			ok: 1,
			timestamp: { $dateTrunc: { date: '$checkedAt', unit: 'minute', binSize: bucketMinutes, timezone: 'UTC' } },
		} },
		{ $group: {
			_id: { component: '$component', timestamp: '$timestamp' },
			statuses: { $addToSet: '$status' },
			sampleCount: { $sum: 1 },
			successCount: { $sum: { $cond: ['$ok', 1, 0] } },
		} },
	]).toArray();
	return buildTodayTimelines(grouped, now, bucketMinutes);
}

export async function readIncidents(limit = 20) {
	const incidents = collection('monitor_incidents');
	if (!incidents) return [];
	return incidents.find({ source: STATUS_SOURCE }, { projection: { _id: 0, source: 0, internalReason: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray();
}

export async function readDailyRollups(from, to) {
	const rollups = collection('monitor_daily_rollups');
	if (!rollups) return [];
	const query = { source: STATUS_SOURCE };
	if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
	return rollups.find(query, { projection: { _id: 0, source: 0 } }).sort({ date: 1, component: 1 }).toArray();
}

export function overallStatus(components) {
	if (components.some((item) => item.status === 'major_outage')) return 'major_outage';
	if (components.some((item) => item.status === 'partial_outage')) return 'partial_outage';
	if (components.some((item) => item.status === 'degraded')) return 'degraded';
	if (components.some((item) => item.status === 'unknown')) return 'unknown';
	return 'operational';
}

export function stabilizeStatus(result, previous, options = {}) {
	const warningSamples = options.warningSamples ?? Number(process.env.MONITOR_WARNING_SAMPLES || 10);
	const criticalSamples = options.criticalSamples ?? Number(process.env.MONITOR_CRITICAL_SAMPLES || 4);
	const recoverySamples = options.recoverySamples ?? Number(process.env.MONITOR_RECOVERY_SAMPLES || 2);
	const rawStatus = result.status;
	const statusStreak = previous?.rawStatus === rawStatus ? (previous.statusStreak || 0) + 1 : 1;
	let status = rawStatus;
	let message = result.message;

	if (rawStatus === 'degraded' && statusStreak < warningSamples && previous?.status !== 'degraded' && previous?.status !== 'major_outage') {
		status = 'operational';
		message = 'Operating normally. A brief resource warning is being verified.';
	} else if ((rawStatus === 'partial_outage' || rawStatus === 'major_outage') && statusStreak < criticalSamples && previous?.status !== rawStatus) {
		status = 'degraded';
		message = `A failure signal is being verified. ${result.message}`;
	} else if (rawStatus === 'operational' && previous && ['degraded', 'partial_outage', 'major_outage'].includes(previous.status) && statusStreak < recoverySamples) {
		status = previous.status;
		message = 'Resource or service health is recovering; confirmation is in progress.';
	}

	return { status, message, rawStatus, statusStreak };
}

export async function recordCheck(result) {
	const now = new Date();
	const current = collection('monitor_current_status');
	const samples = collection('monitor_samples');
	const incidents = collection('monitor_incidents');
	if (!current || !samples) return;
	const previous = await current.findOne({ source: STATUS_SOURCE, component: result.component });
	const stabilized = stabilizeStatus(result, previous);
	const outage = result.status === 'partial_outage' || result.status === 'major_outage';
	const consecutiveFailures = outage ? stabilized.statusStreak : 0;
	const effectiveStatus = stabilized.status;
	const doc = {
		source: STATUS_SOURCE,
		component: result.component, name: result.name, status: effectiveStatus, message: stabilized.message,
		lastCheckedAt: now, lastSuccessAt: result.ok ? now : (previous?.lastSuccessAt || null),
		latencyMs: result.latencyMs ?? null, uptimePercent: result.uptimePercent ?? null, consecutiveFailures,
		rawStatus: stabilized.rawStatus, statusStreak: stabilized.statusStreak,
		metrics: result.metrics || null,
	};
	await current.replaceOne({ source: STATUS_SOURCE, component: result.component }, doc, { upsert: true });
	await samples.insertOne({ ...doc, ok: Boolean(result.ok), checkedAt: now });
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const [sampleCount, successCount] = await Promise.all([
		samples.countDocuments({ source: STATUS_SOURCE, component: result.component, checkedAt: { $gte: dayStart } }),
		samples.countDocuments({ source: STATUS_SOURCE, component: result.component, checkedAt: { $gte: dayStart }, ok: true }),
	]);
	await current.updateOne({ source: STATUS_SOURCE, component: result.component }, { $set: { uptimePercent: sampleCount ? (successCount / sampleCount) * 100 : null } });
	const activeIncident = incidents ? await incidents.findOne({ source: STATUS_SOURCE, component: result.component, resolvedAt: null }) : null;
	if (incidents && previous && previous.status !== effectiveStatus && effectiveStatus !== 'operational' && !activeIncident) {
		await incidents.insertOne({ source: STATUS_SOURCE, component: result.component, name: result.name, status: effectiveStatus,
			severity: effectiveStatus === 'degraded' ? 'warning' : 'critical',
			title: `${result.name} is ${effectiveStatus.replaceAll('_', ' ')}`, description: stabilized.message,
			internalReason: result.error || result.message, startedAt: now, resolvedAt: null, updates: [] });
	}
	if (incidents && activeIncident && effectiveStatus !== 'operational') {
		await incidents.updateOne({ _id: activeIncident._id }, { $set: {
			status: effectiveStatus,
			severity: effectiveStatus === 'degraded' ? 'warning' : 'critical',
			title: `${result.name} is ${effectiveStatus.replaceAll('_', ' ')}`,
			description: stabilized.message,
			updatedAt: now,
		} });
	}
	if (incidents && previous && previous.status !== 'operational' && effectiveStatus === 'operational') {
		await incidents.updateMany({ source: STATUS_SOURCE, component: result.component, resolvedAt: null }, { $set: { resolvedAt: now, updatedAt: now } });
	}
}

export async function cleanupSamples() {
	const samples = collection('monitor_samples');
	if (samples) await samples.deleteMany({ checkedAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } });
}

export async function rollupDay(dateKey) {
	const samples = collection('monitor_samples');
	const rollups = collection('monitor_daily_rollups');
	if (!samples || !rollups) return;
	const start = new Date(`${dateKey}T00:00:00.000Z`);
	const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	const grouped = await samples.aggregate([{ $match: { source: STATUS_SOURCE, checkedAt: { $gte: start, $lt: end } } }, { $sort: { checkedAt: 1 } }, { $group: {
		_id: '$component', name: { $last: '$name' }, sampleCount: { $sum: 1 }, successCount: { $sum: { $cond: ['$ok', 1, 0] } },
		avgLatencyMs: { $avg: '$latencyMs' }, maxLatencyMs: { $max: '$latencyMs' }, lastStatus: { $last: '$status' }, statuses: { $addToSet: '$status' },
	} }]).toArray();
	for (const item of grouped) await rollups.replaceOne({ date: dateKey, component: item._id }, {
		source: STATUS_SOURCE, date: dateKey, component: item._id, name: item.name, sampleCount: item.sampleCount, successCount: item.successCount,
		availabilityPercent: item.sampleCount ? (item.successCount / item.sampleCount) * 100 : 0,
		avgLatencyMs: item.avgLatencyMs ?? null, maxLatencyMs: item.maxLatencyMs ?? null, lastStatus: item.lastStatus,
		healthStatus: worstStatus(item.statuses), updatedAt: new Date(),
	}, { upsert: true });
}

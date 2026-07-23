import { getMongoDb } from '../../db/mongo.js';

const COMPONENTS = [
	{ id: 'athens-web', name: 'Athens web application' },
	{ id: 'athens-api', name: 'Athens API' },
	{ id: 'ai-bff', name: 'AI services' },
	{ id: 'avalon-relay', name: 'Avalon relay' },
	{ id: 'mongodb', name: 'MongoDB' },
	{ id: 'vps', name: 'VPS infrastructure' },
	{ id: 'public-api', name: 'Public API request path' },
];

function collection(name) { return getMongoDb()?.collection(name) || null; }
export function getComponentDefinitions() { return COMPONENTS; }

export async function readCurrentStatus() {
	const current = collection('monitor_current_status');
	const docs = current ? await current.find({}).sort({ component: 1 }).toArray() : [];
	const byId = new Map(docs.map((doc) => [doc.component, doc]));
	return COMPONENTS.map((component) => byId.get(component.id) || {
		component: component.id, name: component.name, status: 'unknown', message: 'No monitoring sample is available yet.',
		lastCheckedAt: null, lastSuccessAt: null, latencyMs: null, uptimePercent: null,
	});
}

export async function readIncidents(limit = 20) {
	const incidents = collection('monitor_incidents');
	if (!incidents) return [];
	return incidents.find({}, { projection: { _id: 0, internalReason: 0 } }).sort({ startedAt: -1 }).limit(limit).toArray();
}

export async function readDailyRollups(from, to) {
	const rollups = collection('monitor_daily_rollups');
	if (!rollups) return [];
	const query = {};
	if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
	return rollups.find(query, { projection: { _id: 0 } }).sort({ date: 1, component: 1 }).toArray();
}

export function overallStatus(components) {
	if (components.some((item) => item.status === 'major_outage')) return 'major_outage';
	if (components.some((item) => item.status === 'partial_outage')) return 'partial_outage';
	if (components.some((item) => item.status === 'degraded')) return 'degraded';
	if (components.some((item) => item.status === 'unknown')) return 'unknown';
	return 'operational';
}

export async function recordCheck(result) {
	const now = new Date();
	const current = collection('monitor_current_status');
	const samples = collection('monitor_samples');
	const incidents = collection('monitor_incidents');
	if (!current || !samples) return;
	const previous = await current.findOne({ component: result.component });
	const consecutiveFailures = result.ok ? 0 : (previous?.consecutiveFailures || 0) + 1;
	const effectiveStatus = result.status === 'unknown' ? 'unknown' : (result.ok ? 'operational' : (consecutiveFailures >= 2 ? 'major_outage' : 'degraded'));
	const doc = {
		component: result.component, name: result.name, status: effectiveStatus, message: result.message,
		lastCheckedAt: now, lastSuccessAt: result.ok ? now : (previous?.lastSuccessAt || null),
		latencyMs: result.latencyMs ?? null, uptimePercent: result.uptimePercent ?? null, consecutiveFailures,
		metrics: result.metrics || previous?.metrics || null,
	};
	await current.replaceOne({ component: result.component }, doc, { upsert: true });
	await samples.insertOne({ ...doc, ok: Boolean(result.ok), checkedAt: now });
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const [sampleCount, successCount] = await Promise.all([
		samples.countDocuments({ component: result.component, checkedAt: { $gte: dayStart } }),
		samples.countDocuments({ component: result.component, checkedAt: { $gte: dayStart }, ok: true }),
	]);
	await current.updateOne({ component: result.component }, { $set: { uptimePercent: sampleCount ? (successCount / sampleCount) * 100 : null } });
	const activeIncident = incidents ? await incidents.findOne({ component: result.component, resolvedAt: null }) : null;
	if (incidents && previous && previous.status !== effectiveStatus && effectiveStatus !== 'operational' && !activeIncident) {
		await incidents.insertOne({ component: result.component, name: result.name, status: effectiveStatus,
			severity: effectiveStatus === 'degraded' ? 'warning' : 'critical',
			title: `${result.name} is ${effectiveStatus.replaceAll('_', ' ')}`, description: result.message,
			internalReason: result.error || result.message, startedAt: now, resolvedAt: null, updates: [] });
	}
	if (incidents && previous && previous.status !== 'operational' && result.status === 'operational') {
		await incidents.updateMany({ component: result.component, resolvedAt: null }, { $set: { resolvedAt: now, updatedAt: now } });
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
	const grouped = await samples.aggregate([{ $match: { checkedAt: { $gte: start, $lt: end } } }, { $sort: { checkedAt: 1 } }, { $group: {
		_id: '$component', name: { $last: '$name' }, sampleCount: { $sum: 1 }, successCount: { $sum: { $cond: ['$ok', 1, 0] } },
		avgLatencyMs: { $avg: '$latencyMs' }, maxLatencyMs: { $max: '$latencyMs' }, lastStatus: { $last: '$status' },
	} }]).toArray();
	for (const item of grouped) await rollups.replaceOne({ date: dateKey, component: item._id }, {
		date: dateKey, component: item._id, name: item.name, sampleCount: item.sampleCount, successCount: item.successCount,
		availabilityPercent: item.sampleCount ? (item.successCount / item.sampleCount) * 100 : 0,
		avgLatencyMs: item.avgLatencyMs ?? null, maxLatencyMs: item.maxLatencyMs ?? null, lastStatus: item.lastStatus, updatedAt: new Date(),
	}, { upsert: true });
}

import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import {
	readPrometheusCurrentStatus,
	readPrometheusDailyRollup,
	readPrometheusLiveMetrics,
	readPrometheusTodayTimeline,
} from './prometheusClient.js';

export const STATUS_SOURCE = 'production';
export const STATUS_V2_COLLECTIONS = {
	current: 'monitor_status_v2',
	days: 'monitor_days_v2',
	incidents: 'monitor_incidents_v2',
};

const COMPONENTS = [
	{ id: 'athens-web', name: 'Athens web application', failureStatus: 'major_outage' },
	{ id: 'athens-api', name: 'Athens API', failureStatus: 'major_outage' },
	{ id: 'ai-bff', name: 'AI services', failureStatus: 'partial_outage' },
	{ id: 'avalon-relay', name: 'Avalon relay', failureStatus: 'partial_outage' },
	{ id: 'firestore', name: 'Cloud Firestore', failureStatus: 'major_outage' },
	{ id: 'storage', name: 'Cloud Storage', failureStatus: 'partial_outage' },
	{ id: 'redis', name: 'Redis cache', failureStatus: 'degraded' },
	{ id: 'qdrant', name: 'Qdrant vector search', failureStatus: 'degraded' },
	{ id: 'vps', name: 'VPS infrastructure', failureStatus: 'degraded' },
	{ id: 'public-api', name: 'Public API request path', failureStatus: 'major_outage' },
];

const STATUS_PRIORITY = {
	operational: 0,
	unknown: 1,
	maintenance: 2,
	degraded: 3,
	partial_outage: 4,
	major_outage: 5,
};

const rollupAttempts = new Map();

export function getComponentDefinitions() {
	return COMPONENTS.map((component) => ({ ...component }));
}

function firestore(db) {
	return db || getFirestoreDb();
}

function asDate(value) {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value.toDate === 'function') return value.toDate();
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function publicIncident(snapshot) {
	const data = typeof snapshot.data === 'function' ? snapshot.data() : snapshot;
	return {
		id: snapshot.id || data.id || null,
		component: data.component,
		name: data.name,
		status: data.status,
		severity: data.severity,
		title: data.title,
		description: data.description,
		startedAt: asDate(data.startedAt),
		resolvedAt: asDate(data.resolvedAt),
		updatedAt: asDate(data.updatedAt),
		updates: (data.updates || []).map((update) => ({ ...update, createdAt: asDate(update.createdAt) })),
	};
}

function defaultComponent(definition) {
	return {
		component: definition.id,
		name: definition.name,
		status: 'unknown',
		message: 'No monitoring sample is available yet.',
		lastCheckedAt: null,
		lastSuccessAt: null,
		latencyMs: null,
		uptimePercent: null,
	};
}

function statusMessage(status) {
	if (status === 'operational') return 'Operating normally.';
	if (status === 'degraded') return 'The dependency is degraded; fallback behavior remains available.';
	if (status === 'partial_outage') return 'Part of this service is currently unavailable.';
	if (status === 'major_outage') return 'This service is currently unavailable.';
	if (status === 'maintenance') return 'Maintenance is in progress.';
	return 'Monitoring data is unavailable or stale.';
}

async function readSnapshot(db) {
	const snapshot = await firestore(db).collection(STATUS_V2_COLLECTIONS.current).doc(STATUS_SOURCE).get();
	if (!snapshot.exists) return null;
	const data = snapshot.data();
	return {
		...data,
		updatedAt: asDate(data.updatedAt),
		components: (data.components || []).map((component) => ({
			...component,
			lastCheckedAt: asDate(component.lastCheckedAt),
			lastSuccessAt: asDate(component.lastSuccessAt),
		})),
	};
}

export function markStaleComponent(component, now = Date.now(), staleAfterMs = Number(process.env.MONITOR_STALE_AFTER_MS || 120000)) {
	const checkedAt = asDate(component?.lastCheckedAt)?.getTime() || 0;
	if (!component || !checkedAt || now - checkedAt <= staleAfterMs) return component;
	return { ...component, status: 'unknown', message: 'Monitoring data is stale.' };
}

export async function readCurrentStatus({ db, prometheusOptions } = {}) {
	const definitions = getComponentDefinitions();
	let fallback = null;
	try { fallback = await readSnapshot(db); } catch { fallback = null; }
	const fallbackById = new Map((fallback?.components || []).map((component) => [component.component, markStaleComponent(component)]));
	try {
		const live = await readPrometheusCurrentStatus(definitions, prometheusOptions);
		return definitions.map((definition) => {
			const current = live.get(definition.id);
			const stored = fallbackById.get(definition.id);
			if (!current) return stored || defaultComponent(definition);
			return {
				...defaultComponent(definition),
				...current,
				message: stored?.status === current.status ? stored.message : statusMessage(current.status),
				lastSuccessAt: current.status === 'operational' ? current.lastCheckedAt : (stored?.lastSuccessAt || null),
			};
		});
	} catch {
		return definitions.map((definition) => fallbackById.get(definition.id) || defaultComponent(definition));
	}
}

function averageMetric(items, name) {
	const values = items.map((item) => item.metrics?.[name]).filter((value) => Number.isFinite(value));
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function toPercent(value) {
	return value == null ? null : Math.round(value * 1000) / 10;
}

// Retained as a pure helper for migration/tests; production live data comes
// directly from Prometheus and never scans Firestore samples.
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

export async function readLiveMetrics(minutes = 60, options = {}) {
	return readPrometheusLiveMetrics(minutes, options.prometheusOptions || options);
}

function worstStatus(statuses = []) {
	const known = statuses.filter((status) => status !== 'unknown');
	if (!known.length) return 'unknown';
	return known.reduce((worst, status) => (STATUS_PRIORITY[status] ?? 1) > (STATUS_PRIORITY[worst] ?? 1) ? status : worst, 'operational');
}

// Retained for deterministic timeline unit tests and empty-state rendering.
export function buildTodayTimelines(grouped, now = new Date(), bucketMinutes = 15) {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const bucketMs = bucketMinutes * 60 * 1000;
	const slotCount = Math.floor((now.getTime() - start.getTime()) / bucketMs) + 1;
	const bySlot = new Map(grouped.map((item) => [`${item._id.component}:${new Date(item._id.timestamp).getTime()}`, item]));
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

export async function readTodayTimelines(now = new Date(), bucketMinutes = 15, options = {}) {
	return readPrometheusTodayTimeline(getComponentDefinitions(), now, bucketMinutes, options.prometheusOptions || options);
}

export async function readIncidents(limit = 20, { db } = {}) {
	const snapshot = await firestore(db).collection(STATUS_V2_COLLECTIONS.incidents).limit(Math.max(limit * 5, 100)).get();
	return snapshot.docs.map(publicIncident)
		.sort((left, right) => (right.startedAt?.getTime() || 0) - (left.startedAt?.getTime() || 0))
		.slice(0, limit);
}

export async function readDailyRollups(from, to, { db } = {}) {
	const snapshot = await firestore(db).collection(STATUS_V2_COLLECTIONS.days).limit(180).get();
	return snapshot.docs
		.map((doc) => doc.data())
		.filter((day) => (!from || day.date >= from) && (!to || day.date <= to) && day.complete === true)
		.flatMap((day) => (day.components || []).map((component) => ({
			date: day.date,
			component: component.component,
			name: component.name,
			sampleCount: component.sampleCount,
			successCount: component.successCount,
			availabilityPercent: component.availabilityPercent,
			avgLatencyMs: component.avgLatencyMs ?? null,
			maxLatencyMs: component.maxLatencyMs ?? null,
			healthStatus: component.healthStatus,
			coveragePercent: component.coveragePercent,
		})))
		.sort((left, right) => left.date.localeCompare(right.date) || left.component.localeCompare(right.component));
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
		message = 'Operating normally. A brief warning is being verified.';
	} else if ((rawStatus === 'partial_outage' || rawStatus === 'major_outage') && statusStreak < criticalSamples && previous?.status !== rawStatus) {
		status = 'degraded';
		message = `A failure signal is being verified. ${result.message}`;
	} else if (rawStatus === 'operational' && previous && ['degraded', 'partial_outage', 'major_outage'].includes(previous.status) && statusStreak < recoverySamples) {
		status = previous.status;
		message = 'Service health is recovering; confirmation is in progress.';
	}

	return { status, message, rawStatus, statusStreak };
}

export function prepareStatusResults(results, previousByComponent = new Map(), options = {}) {
	return results.map((result) => {
		const stabilized = stabilizeStatus(result, previousByComponent.get(result.component), options);
		return { ...result, ...stabilized };
	});
}

function isIncidentStatus(status) {
	return ['degraded', 'partial_outage', 'major_outage'].includes(status);
}

export async function recordChecks(results, { db, now = new Date() } = {}) {
	const store = firestore(db);
	const currentRef = store.collection(STATUS_V2_COLLECTIONS.current).doc(STATUS_SOURCE);
	const existing = await currentRef.get();
	const previousData = existing.exists ? existing.data() : {};
	const previousById = new Map((previousData.components || []).map((component) => [component.component, component]));
	const activeIncidentIds = { ...(previousData.activeIncidentIds || {}) };
	const batch = store.batch();
	const components = results.map((result) => {
		const previous = previousById.get(result.component);
		const lastSuccessAt = result.ok ? now : (asDate(previous?.lastSuccessAt) || null);
		const activeId = activeIncidentIds[result.component];
		if (isIncidentStatus(result.status) && !activeId) {
			const incidentRef = store.collection(STATUS_V2_COLLECTIONS.incidents).doc();
			activeIncidentIds[result.component] = incidentRef.id;
			batch.set(incidentRef, {
				source: STATUS_SOURCE,
				component: result.component,
				name: result.name,
				status: result.status,
				severity: result.status === 'degraded' ? 'warning' : 'critical',
				title: `${result.name} is ${result.status.replaceAll('_', ' ')}`,
				description: result.message,
				internalReason: result.error || result.message,
				startedAt: now,
				updatedAt: now,
				resolvedAt: null,
				updates: [],
			});
		} else if (isIncidentStatus(result.status) && activeId) {
			batch.update(store.collection(STATUS_V2_COLLECTIONS.incidents).doc(activeId), {
				status: result.status,
				severity: result.status === 'degraded' ? 'warning' : 'critical',
				title: `${result.name} is ${result.status.replaceAll('_', ' ')}`,
				description: result.message,
				updatedAt: now,
			});
		} else if (result.status === 'operational' && activeId) {
			batch.update(store.collection(STATUS_V2_COLLECTIONS.incidents).doc(activeId), { status: 'resolved', resolvedAt: now, updatedAt: now });
			delete activeIncidentIds[result.component];
		}
		return {
			component: result.component,
			name: result.name,
			status: result.status,
			message: result.message,
			lastCheckedAt: now,
			lastSuccessAt,
			latencyMs: result.latencyMs ?? null,
			uptimePercent: result.uptimePercent ?? null,
			consecutiveFailures: result.ok ? 0 : (result.statusStreak || 1),
			rawStatus: result.rawStatus || result.status,
			statusStreak: result.statusStreak || 1,
			metrics: result.metrics || null,
		};
	});
	batch.set(currentRef, {
		source: STATUS_SOURCE,
		version: 2,
		updatedAt: now,
		components,
		activeIncidentIds,
	}, { merge: false });
	await batch.commit();
	return components;
}

export async function cleanupSamples() {
	return 0;
}

export async function rollupDay(dateKey, { db, prometheusOptions, force = false } = {}) {
	const store = firestore(db);
	const dayRef = store.collection(STATUS_V2_COLLECTIONS.days).doc(dateKey);
	if (!force) {
		const existing = await dayRef.get();
		if (existing.exists && existing.data()?.complete === true) return existing.data();
		const lastAttempt = rollupAttempts.get(dateKey) || 0;
		if (Date.now() - lastAttempt < 60 * 60 * 1000) return null;
	}
	rollupAttempts.set(dateKey, Date.now());
	const rollup = await readPrometheusDailyRollup(getComponentDefinitions(), dateKey, prometheusOptions);
	if (!rollup.complete) return null;
	const document = { source: STATUS_SOURCE, version: 2, ...rollup, updatedAt: new Date() };
	await dayRef.set(document, { merge: false });
	return document;
}

export async function createManualIncident({ component, status, severity, title, description }, { db, now = new Date() } = {}) {
	const definition = getComponentDefinitions().find((item) => item.id === component);
	if (!definition) throw new Error('Unknown status component');
	const ref = firestore(db).collection(STATUS_V2_COLLECTIONS.incidents).doc();
	const incident = {
		source: STATUS_SOURCE,
		component,
		name: definition.name,
		status,
		severity,
		title,
		description,
		startedAt: now,
		updatedAt: now,
		resolvedAt: status === 'resolved' ? now : null,
		updates: [{ status, message: description, createdAt: now }],
		manual: true,
	};
	await ref.set(incident);
	return publicIncident({ id: ref.id, ...incident });
}

export async function updateManualIncident(id, { status, message }, { db, now = new Date() } = {}) {
	const ref = firestore(db).collection(STATUS_V2_COLLECTIONS.incidents).doc(id);
	const snapshot = await ref.get();
	if (!snapshot.exists) return null;
	const update = {
		updatedAt: now,
		...(status ? { status } : {}),
		...(status === 'resolved' ? { resolvedAt: now } : {}),
		updates: FieldValue.arrayUnion({ ...(status ? { status } : {}), ...(message ? { message } : {}), createdAt: now }),
	};
	await ref.update(update);
	const changed = await ref.get();
	return publicIncident(changed);
}

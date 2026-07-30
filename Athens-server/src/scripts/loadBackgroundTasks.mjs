/**
 * Live acceptance harness for the shared background-task platform.
 *
 * Required: LOAD_BASE_URL, LOAD_PROFILE_ID, LOAD_APPLIER_NAME
 * Optional: LOAD_FIREBASE_TOKEN, LOAD_JOB_IDS (comma-separated),
 * LOAD_DURATION_MS, LOAD_CANCEL_AFTER_MS, LOAD_ASSERT=1.
 */

const baseUrl = String(process.env.LOAD_BASE_URL || 'http://127.0.0.1:8979/api').replace(/\/$/, '');
const profileId = String(process.env.LOAD_PROFILE_ID || '').trim();
const applierName = String(process.env.LOAD_APPLIER_NAME || '').trim();
const token = String(process.env.LOAD_FIREBASE_TOKEN || '').trim();
const durationMs = Math.max(10_000, Number(process.env.LOAD_DURATION_MS || 10 * 60_000));
const cancelAfterMs = Math.max(0, Number(process.env.LOAD_CANCEL_AFTER_MS || 0));
const enforce = String(process.env.LOAD_ASSERT || '') === '1';

if (!profileId || !applierName) {
	throw new Error('LOAD_PROFILE_ID and LOAD_APPLIER_NAME are required');
}

const headers = {
	'Content-Type': 'application/json',
	...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function api(path, init = {}) {
	const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} failed (${response.status}): ${data.error || 'unknown error'}`);
	return data;
}

function collectJobIds(value, output = new Set()) {
	if (!value || output.size >= 100) return output;
	if (Array.isArray(value)) {
		for (const entry of value) collectJobIds(entry, output);
		return output;
	}
	if (typeof value !== 'object') return output;
	const looksLikeJob = typeof value.title === 'string'
		|| typeof value.backendId === 'string'
		|| typeof value.jobDescription === 'string';
	if (looksLikeJob) {
		for (const key of ['backendId', '_id', 'id']) {
			const candidate = value[key];
			if (typeof candidate === 'string' && candidate.trim()) output.add(candidate.trim());
		}
	}
	for (const entry of Object.values(value)) collectJobIds(entry, output);
	return output;
}

async function resolveResumeJobIds() {
	const configured = String(process.env.LOAD_JOB_IDS || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	if (configured.length >= 100) return [...new Set(configured)].slice(0, 100);
	const response = await api('/jobs/list/v2', {
		method: 'POST',
		body: JSON.stringify({ applierName, profileId, page: 1, limit: 100, status: 'all' }),
	});
	const discovered = [...collectJobIds(response.data || response)].filter((id) => !configured.includes(id));
	const ids = [...new Set([...configured, ...discovered])].slice(0, 100);
	if (ids.length < 100) throw new Error(`Load test requires 100 job ids; only ${ids.length} were available`);
	return ids;
}

async function startTask(type, payload) {
	const response = await api('/background-tasks', {
		method: 'POST',
		body: JSON.stringify({
			requestId: crypto.randomUUID(),
			type,
			profileId,
			applierName,
			payload,
		}),
	});
	return response.task;
}

function percentile(values, quantile) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

const jobIds = await resolveResumeJobIds();
const tasks = await Promise.all([
	startTask('resume_generation', { jobIds, deferPdf: true, origin: 'job_search' }),
	startTask('title_review', { limit: 1_000 }),
	startTask('skill_extraction', { limit: 1_000 }),
]);
const taskIds = tasks.map((task) => task.id);
const latencies = [];
const failures = [];
const startedAt = Date.now();
let cancellationSentAt = null;
let cancellationAcceptedAt = null;
let cancellationFinishedAt = null;
let cancellationTargets = [];
let terminal = new Map();
let latestSnapshots = [];
let probe = 0;

while (Date.now() - startedAt < durationMs && terminal.size < taskIds.length) {
	const page = (probe % 4) + 1;
	const search = probe % 2 ? 'software' : '';
	const before = performance.now();
	try {
		await api('/jobs/list/v2', {
			method: 'POST',
			body: JSON.stringify({ applierName, profileId, page, limit: 25, status: 'all', search }),
		});
		latencies.push(performance.now() - before);
	} catch (error) {
		failures.push(error.message);
	}

	const snapshots = await Promise.all(taskIds.map((id) => api(`/background-tasks/${encodeURIComponent(id)}`)));
	latestSnapshots = snapshots.map((snapshot) => snapshot.task);
	for (const snapshot of snapshots) {
		if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(snapshot.task.status)) {
			terminal.set(snapshot.task.id, snapshot.task);
		}
	}

	if (cancelAfterMs && !cancellationSentAt && Date.now() - startedAt >= cancelAfterMs) {
		cancellationSentAt = Date.now();
		cancellationTargets = latestSnapshots
			.filter((task) => ['queued', 'running', 'cancelling'].includes(task.status))
			.map((task) => task.id);
		await Promise.all(cancellationTargets.map((id) => api(`/background-tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' })));
		cancellationAcceptedAt = Date.now();
	}
	if (
		cancellationAcceptedAt
		&& !cancellationFinishedAt
		&& cancellationTargets.length > 0
		&& cancellationTargets.every((id) => terminal.get(id)?.status === 'cancelled')
	) {
		cancellationFinishedAt = Date.now();
	}
	probe += 1;
	await new Promise((resolve) => setTimeout(resolve, 200));
}

const report = {
	tasks: taskIds,
	probes: latencies.length,
	probeFailures: failures.length,
	p50Ms: percentile(latencies, 0.5),
	p95Ms: percentile(latencies, 0.95),
	p99Ms: percentile(latencies, 0.99),
	maxMs: latencies.length ? Math.max(...latencies) : null,
	cancelResponseMs: cancellationAcceptedAt ? cancellationAcceptedAt - cancellationSentAt : null,
	cancelAcknowledgementMs: cancellationFinishedAt ? cancellationFinishedAt - cancellationAcceptedAt : null,
	cancelWorkerLatenciesMs: cancellationTargets.map((id) => {
		const task = terminal.get(id);
		const requested = Date.parse(task?.cancelRequestedAt || '');
		const acknowledged = Date.parse(task?.cancelAcknowledgedAt || '');
		return Number.isFinite(requested) && Number.isFinite(acknowledged) ? Math.max(0, acknowledged - requested) : null;
	}),
	terminal: Object.fromEntries([...terminal].map(([id, task]) => [id, task.status])),
	failures: failures.slice(0, 10),
};

console.log(JSON.stringify(report, null, 2));
if (enforce && (
	failures.length
	|| report.p95Ms == null
	|| report.p95Ms >= 2_000
	|| (cancelAfterMs && report.cancelResponseMs != null && report.cancelResponseMs >= 500)
	|| (cancelAfterMs && (
		report.cancelAcknowledgementMs == null
		|| report.cancelAcknowledgementMs >= 1_000
		|| report.cancelWorkerLatenciesMs.some((latency) => latency == null || latency >= 1_000)
	))
)) process.exitCode = 1;

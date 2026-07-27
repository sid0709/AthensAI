import cluster from 'node:cluster';
import http from 'node:http';

const counters = new Map();
const gauges = new Map();
const histograms = new Map();
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const METRIC_MESSAGE = 'athens:metric';

let aggregateServer = null;

function key(name, labels = {}) {
	return `${name}|${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')}`;
}

function labelsText(labels = {}) {
	const entries = Object.entries(labels);
	return entries.length
		? `{${entries.map(([name, value]) => `${name}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`
		: '';
}

function publish(operation, payload) {
	if (!cluster.isWorker || typeof process.send !== 'function') return;
	process.send({ type: METRIC_MESSAGE, operation, ...payload });
}

export function incrementCounter(name, labels = {}, value = 1, { publishToPrimary = true } = {}) {
	const k = key(name, labels);
	counters.set(k, { name, labels, value: (counters.get(k)?.value || 0) + value });
	if (publishToPrimary) publish('counter', { name, labels, value });
}

export function setGauge(name, labels = {}, value, { publishToPrimary = true } = {}) {
	gauges.set(key(name, labels), { name, labels, value: Number(value) || 0 });
	if (publishToPrimary) publish('gauge', { name, labels, value: Number(value) || 0 });
}

export function observeHistogram(name, labels = {}, seconds, { publishToPrimary = true } = {}) {
	const k = key(name, labels);
	const current = histograms.get(k) || { name, labels, buckets: LATENCY_BUCKETS.map((le) => ({ le, value: 0 })), count: 0, sum: 0 };
	for (const bucket of current.buckets) if (seconds <= bucket.le) bucket.value += 1;
	current.count += 1;
	current.sum += seconds;
	histograms.set(k, current);
	if (publishToPrimary) publish('histogram', { name, labels, seconds });
}

export function applyMetricMessage(message) {
	if (!message || message.type !== METRIC_MESSAGE) return false;
	if (message.operation === 'counter') incrementCounter(message.name, message.labels, Number(message.value) || 0, { publishToPrimary: false });
	else if (message.operation === 'gauge') setGauge(message.name, message.labels, message.value, { publishToPrimary: false });
	else if (message.operation === 'histogram') observeHistogram(message.name, message.labels, Number(message.seconds) || 0, { publishToPrimary: false });
	else return false;
	return true;
}

export function metricsMiddleware(req, res, next) {
	const started = process.hrtime.bigint();
	res.on('finish', () => {
		const seconds = Number(process.hrtime.bigint() - started) / 1e9;
		const route = req.route?.path || req.path.split('/').slice(0, 3).join('/') || '/';
		incrementCounter('athens_http_requests_total', { method: req.method, route: String(route), status: String(res.statusCode) });
		observeHistogram('athens_http_request_duration_seconds', { method: req.method, route: String(route) }, seconds);
	});
	next();
}

function writeSamples(lines, items, type) {
	for (const item of items) {
		lines.push(`# TYPE ${item.name} ${type}`);
		lines.push(`${item.name}${labelsText(item.labels)} ${item.value}`);
	}
}

export function renderMetrics(service = 'athens-server') {
	const lines = ['# HELP athens_metrics_exporter_info Athens application metrics exporter.', '# TYPE athens_metrics_exporter_info gauge', `athens_metrics_exporter_info{service="${service}"} 1`];
	writeSamples(lines, [...counters.values()], 'counter');
	writeSamples(lines, [...gauges.values()], 'gauge');
	for (const item of histograms.values()) {
		lines.push(`# TYPE ${item.name} histogram`);
		for (const bucket of item.buckets) lines.push(`${item.name}_bucket${labelsText({ ...item.labels, le: bucket.le })} ${bucket.value}`);
		lines.push(`${item.name}_bucket${labelsText({ ...item.labels, le: '+Inf' })} ${item.count}`);
		lines.push(`${item.name}_sum${labelsText(item.labels)} ${item.sum}`);
		lines.push(`${item.name}_count${labelsText(item.labels)} ${item.count}`);
	}
	return `${lines.join('\n')}\n`;
}

export function setHealthMetric(component, healthy) {
	setGauge('athens_health_status', { component }, healthy ? 1 : 0);
}

export function setHealthStateMetrics(component, status, checkedAt = new Date()) {
	const statuses = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'];
	const severity = { operational: 0, degraded: 1, maintenance: 1, partial_outage: 2, major_outage: 3, unknown: 4 };
	for (const candidate of statuses) setGauge('athens_health_state', { component, status: candidate }, candidate === status ? 1 : 0);
	setGauge('athens_health_severity', { component }, severity[status] ?? 4);
	setGauge('athens_health_check_timestamp_seconds', { component }, new Date(checkedAt).getTime() / 1000);
}

/**
 * Start the private, cluster-wide metrics listener. In cluster mode workers
 * forward deltas to the primary process; in single-process mode this exposes
 * the same in-memory registry on the monitoring network.
 */
export function startAggregateMetricsServer({
	port = Number(process.env.METRICS_PORT || 9101),
	host = process.env.METRICS_HOST || '0.0.0.0',
} = {}) {
	if (aggregateServer) return aggregateServer;
	if (cluster.isWorker) return null;
	cluster.on?.('message', (_worker, message) => { applyMetricMessage(message); });
	aggregateServer = http.createServer((req, res) => {
		if (req.url !== '/metrics') {
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('Not found');
			return;
		}
		res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
		res.end(renderMetrics('athens-server-cluster'));
	});
	aggregateServer.listen(port, host, () => console.log(`[monitoring] private aggregate metrics listening on ${host}:${port}`));
	aggregateServer.on('error', (error) => console.error('[monitoring] aggregate metrics listener failed:', error.message));
	return aggregateServer;
}

export async function stopAggregateMetricsServer() {
	if (!aggregateServer) return;
	const server = aggregateServer;
	aggregateServer = null;
	await new Promise((resolve) => server.close(() => resolve()));
}

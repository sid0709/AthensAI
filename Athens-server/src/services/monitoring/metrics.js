const counters = new Map();
const gauges = new Map();
const histograms = new Map();
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function key(name, labels = {}) {
	return `${name}|${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')}`;
}

function labelsText(labels = {}) {
	const entries = Object.entries(labels);
	return entries.length
		? `{${entries.map(([name, value]) => `${name}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`
		: '';
}

export function incrementCounter(name, labels = {}, value = 1) {
	const k = key(name, labels);
	counters.set(k, { name, labels, value: (counters.get(k)?.value || 0) + value });
}

export function setGauge(name, labels = {}, value) {
	gauges.set(key(name, labels), { name, labels, value: Number(value) || 0 });
}

export function observeHistogram(name, labels = {}, seconds) {
	const k = key(name, labels);
	const current = histograms.get(k) || { name, labels, buckets: LATENCY_BUCKETS.map((le) => ({ le, value: 0 })), count: 0, sum: 0 };
	for (const bucket of current.buckets) if (seconds <= bucket.le) bucket.value += 1;
	current.count += 1;
	current.sum += seconds;
	histograms.set(k, current);
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

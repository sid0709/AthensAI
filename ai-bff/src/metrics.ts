const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const namedCounters = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
const namedGauges = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
const histograms = new Map<string, {
  name: string;
  labels: Record<string, string>;
  buckets: Array<{ le: number; value: number }>;
  count: number;
  sum: number;
}>();
const HISTOGRAM_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

function labels(labels: Record<string, string>) {
  const entries = Object.entries(labels);
  return entries.length
    ? `{${entries.map(([key, value]) => `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`
    : '';
}

function metricKey(name: string, labelValues: Record<string, string>) {
  return `${name}|${Object.entries(labelValues).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(',')}`;
}

export function incrementMetric(name: string, labelValues: Record<string, string> = {}, value = 1) {
  const key = metricKey(name, labelValues);
  const current = namedCounters.get(key);
  namedCounters.set(key, { name, labels: labelValues, value: (current?.value || 0) + value });
}

export function setMetricGauge(name: string, labelValues: Record<string, string> = {}, value = 0) {
  namedGauges.set(metricKey(name, labelValues), { name, labels: labelValues, value });
}

export function observeMetric(name: string, labelValues: Record<string, string>, seconds: number) {
  const key = metricKey(name, labelValues);
  const current = histograms.get(key) || {
    name,
    labels: labelValues,
    buckets: HISTOGRAM_BUCKETS.map((le) => ({ le, value: 0 })),
    count: 0,
    sum: 0,
  };
  for (const bucket of current.buckets) if (seconds <= bucket.le) bucket.value += 1;
  current.count += 1;
  current.sum += seconds;
  histograms.set(key, current);
}

export function metricsMiddleware(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path || req.path.split('/').slice(0, 3).join('/') || '/';
    const key = labels({ method: req.method, route, status: String(res.statusCode) });
    counters.set(key, (counters.get(key) || 0) + 1);
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    gauges.set(labels({ method: req.method, route }), seconds);
  });
  next();
}

export function renderMetrics() {
  const lines = ['# TYPE athens_http_requests_total counter'];
  for (const [labelSet, value] of counters) lines.push(`athens_http_requests_total${labelSet} ${value}`);
  lines.push('# TYPE athens_http_request_last_duration_seconds gauge');
  for (const [labelSet, value] of gauges) lines.push(`athens_http_request_last_duration_seconds${labelSet} ${value}`);
  lines.push('# TYPE athens_health_status gauge', 'athens_health_status{component="ai-bff"} 1');
  const declaredCounters = new Set<string>();
  for (const metric of namedCounters.values()) {
    if (!declaredCounters.has(metric.name)) {
      lines.push(`# TYPE ${metric.name} counter`);
      declaredCounters.add(metric.name);
    }
    lines.push(`${metric.name}${labels(metric.labels)} ${metric.value}`);
  }
  const declaredGauges = new Set<string>();
  for (const metric of namedGauges.values()) {
    if (!declaredGauges.has(metric.name)) {
      lines.push(`# TYPE ${metric.name} gauge`);
      declaredGauges.add(metric.name);
    }
    lines.push(`${metric.name}${labels(metric.labels)} ${metric.value}`);
  }
  const declaredHistograms = new Set<string>();
  for (const metric of histograms.values()) {
    if (!declaredHistograms.has(metric.name)) {
      lines.push(`# TYPE ${metric.name} histogram`);
      declaredHistograms.add(metric.name);
    }
    for (const bucket of metric.buckets) {
      lines.push(`${metric.name}_bucket${labels({ ...metric.labels, le: String(bucket.le) })} ${bucket.value}`);
    }
    lines.push(`${metric.name}_bucket${labels({ ...metric.labels, le: '+Inf' })} ${metric.count}`);
    lines.push(`${metric.name}_sum${labels(metric.labels)} ${metric.sum}`);
    lines.push(`${metric.name}_count${labels(metric.labels)} ${metric.count}`);
  }
  return `${lines.join('\n')}\n`;
}

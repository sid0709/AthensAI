const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function labels(labels: Record<string, string>) {
  return `{${Object.entries(labels).map(([key, value]) => `${key}="${value.replaceAll('"', '\\"')}"`).join(',')}}`;
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
  return `${lines.join('\n')}\n`;
}

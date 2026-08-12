export const DEFAULT_PROMETHEUS_URL = 'http://prometheus:9090';
export const PROMETHEUS_REQUEST_TIMEOUT_MS = 5000;

/**
 * Available-aware host memory used ratio from node-exporter.
 * Computed inline (not via recording rule) so /status cannot invert
 * MemAvailable/MemTotal as "used" if recorded series drift.
 */
export const NODE_MEMORY_USED_RATIO =
  'max(1 - (node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}))';

export const VPS_QUERIES = {
  cpuUtilization: 'max(athens:node_cpu_utilization:ratio)',
  memoryUtilization: NODE_MEMORY_USED_RATIO,
  diskUtilization: 'max(athens:root_filesystem_utilization:ratio)',
  loadRatio: 'max(athens:node_load_utilization:ratio)',
  uptimeSeconds: 'max(athens:node_uptime_seconds)',
  scrapeAgeSeconds: 'time() - max(timestamp(node_uname_info{job="node"}))',
} as const;

export const LIVE_VPS_QUERIES = Object.fromEntries(
  Object.entries(VPS_QUERIES).filter(([name]) => name !== 'scrapeAgeSeconds'),
);

/** Dependency series after Algolia / Firestore removal. */
export const DEPENDENCY_QUERIES = {
  'background-tasks': {
    oldestQueueAgeSeconds: 'max(athens_background_queue_oldest_age_seconds)',
    expiredLeaseCount: 'max(athens_background_expired_lease_count)',
  },
} as const;

export const SEVERITY_STATUS = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'unknown',
] as const;

export function stepForMinutes(minutes: number, maxPoints = 240): number {
  return Math.max(30, Math.ceil((minutes * 60) / maxPoints));
}

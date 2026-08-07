export const DEFAULT_PROMETHEUS_URL = 'http://prometheus:9090';
export const PROMETHEUS_REQUEST_TIMEOUT_MS = 5000;

export const VPS_QUERIES = {
  cpuUtilization: 'max(athens:node_cpu_utilization:ratio)',
  memoryUtilization: 'max(athens:node_memory_utilization:ratio)',
  diskUtilization: 'max(athens:root_filesystem_utilization:ratio)',
  loadRatio: 'max(athens:node_load_utilization:ratio)',
  uptimeSeconds: 'max(athens:node_uptime_seconds)',
  scrapeAgeSeconds: 'time() - max(timestamp(node_uname_info))',
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

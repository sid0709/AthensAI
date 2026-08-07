export type ComponentStatusRow = {
  component: string;
  name: string;
  status: string;
  message: string;
  lastCheckedAt: Date | string | null;
  lastSuccessAt: Date | string | null;
  latencyMs: number | null;
  uptimePercent: number | null;
};

export type CheckResult = {
  component: string;
  name: string;
  ok: boolean;
  latencyMs: number;
  status: string;
  message: string;
  error?: string;
  metrics?: VpsMetrics | null;
  rawStatus?: string;
  statusStreak?: number;
  uptimePercent?: number | null;
};

export type VpsMetrics = {
  cpuUtilization: number;
  memoryUtilization: number;
  diskUtilization: number;
  loadRatio: number;
  uptimeSeconds: number;
};

export type LiveMetricPoint = {
  timestamp: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  loadPercent: number | null;
  uptimeSeconds: number | null;
};

export type IncidentUpdate = {
  status?: string;
  message?: string;
  createdAt: Date | string;
};

export type PublicIncident = {
  id: string | null;
  component: string;
  name: string;
  status: string;
  severity: string;
  title: string;
  description: string;
  startedAt: Date | null;
  resolvedAt: Date | null;
  updatedAt: Date | null;
  updates: IncidentUpdate[];
};

import { API_BASE } from "@/lib/api-base";

export interface DailyApplicationRow {
  date: string;
  value: number;
}

export interface JobSourceSummaryRow {
  source: string;
  postings: number;
  applied: number;
  scheduled: number;
  declined: number;
}

export interface FrequencyDayRow {
  _id: string;
  hourlyData: { hour: number; count: number }[];
}

type ReportResponse<T> = { success?: boolean; data?: T };

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function getReport<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T[]> {
  const res = await fetch(`${API_BASE}${path}${qs(params)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as ReportResponse<T>;
  return body.success && Array.isArray(body.data) ? body.data : [];
}

export async function fetchDailyApplications(
  applierName: string | undefined,
  startDate: string,
  endDate: string,
): Promise<DailyApplicationRow[]> {
  return getReport<DailyApplicationRow>("/reports/daily-applications", {
    applierName,
    startDate,
    endDate,
  });
}

export async function fetchJobSourceSummary(
  applierName: string | undefined,
  startDate: string,
  endDate: string,
): Promise<JobSourceSummaryRow[]> {
  return getReport<JobSourceSummaryRow>("/reports/job-source-summary", {
    applierName,
    startDate,
    endDate,
  });
}

export async function fetchJobApplicationFrequency(
  applierName: string | undefined,
  startDate: string,
  endDate: string,
): Promise<FrequencyDayRow[]> {
  return getReport<FrequencyDayRow>("/reports/job-application-frequency", {
    applierName,
    startDate,
    endDate,
  });
}

export async function fetchJobStatusCounts(applierName: string | undefined): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${API_BASE}/jobs/list/counts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(applierName ? { applierName } : {}),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { success?: boolean; counts?: Record<string, number> };
    return body.success && body.counts ? body.counts : {};
  } catch {
    return {};
  }
}

export async function fetchAppliedJobDocs(
  applierName: string | undefined,
  limit = 2000,
): Promise<Record<string, unknown>[]> {
  if (!applierName) return [];
  try {
    const res = await fetch(`${API_BASE}/jobs/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applierName,
        applied: true,
        sort: "postedAt_desc",
        page: 1,
        limit,
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { success?: boolean; data?: Record<string, unknown>[] };
    return body.success && Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

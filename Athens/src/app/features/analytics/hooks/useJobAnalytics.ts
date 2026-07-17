import { useEffect, useMemo, useState } from "react";
import { useApplier } from "@/context/applier-context";
import { fetchApplyRuns, type ApplyRunSummary } from "../../../api/avalonLog";
import {
  fetchAppliedJobDocs,
  fetchDailyApplications,
  fetchJobApplicationFrequency,
  fetchJobSourceSummary,
  fetchJobStatusCounts,
  type DailyApplicationRow,
  type FrequencyDayRow,
  type JobSourceSummaryRow,
} from "../../../api/reports";
import { normalizeId } from "../../../lib/job-adapters";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import { rangeToIsoDates } from "../lib/dateRange";
import {
  computeAgentStatusPie,
  computeAvgResponseDays,
  computeCohort,
  computeFunnel,
  computeHeatmap,
  computeMatchScatter,
  computeRolePie,
  computeSourceRows,
  computeStageOverTime,
  computeTrend,
  computeVelocitySeries,
  sumAppliedInRange,
  sumSourceTotals,
  type AgentStatusSlice,
  type CohortPoint,
  type FunnelItem,
  type HeatmapRow,
  type MatchPoint,
  type RoleSlice,
  type SourceRow,
  type StageOverTime,
  type TrendPoint,
  type VelocityPoint,
} from "../lib/computeAnalytics";

export interface JobAnalytics {
  loading: boolean;
  ready: boolean;
  applications: number;
  responseRate: number;
  interviewRate: number;
  avgResponseDays: number | null;
  posted: number;
  agentRuns: number;
  trendData: TrendPoint[];
  rolePie: RoleSlice[];
  heatmapData: HeatmapRow[];
  sourceData: SourceRow[];
  funnel: FunnelItem[];
  stageOverTime: StageOverTime[];
  velocitySeries: VelocityPoint[];
  cohortData: CohortPoint[];
  agentStatusPie: AgentStatusSlice[];
  matchScatter: MatchPoint[];
  pipelineBySource: JobSourceSummaryRow[];
}

const EMPTY: JobAnalytics = {
  loading: true,
  ready: false,
  applications: 0,
  responseRate: 0,
  interviewRate: 0,
  avgResponseDays: null,
  posted: 0,
  agentRuns: 0,
  trendData: [],
  rolePie: [],
  heatmapData: [],
  sourceData: [],
  funnel: [],
  stageOverTime: [],
  velocitySeries: [],
  cohortData: [],
  agentStatusPie: [],
  matchScatter: [],
  pipelineBySource: [],
};

export function useJobAnalytics(range: DateRange): JobAnalytics {
  const { applier, applierReady } = useApplier();
  const applierName = applier?.name;
  const applierId = applier?._id != null ? normalizeId(applier._id) : null;

  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DailyApplicationRow[]>([]);
  const [sourceSummary, setSourceSummary] = useState<JobSourceSummaryRow[]>([]);
  const [frequency, setFrequency] = useState<FrequencyDayRow[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [jobDocs, setJobDocs] = useState<Record<string, unknown>[]>([]);
  const [runs, setRuns] = useState<ApplyRunSummary[]>([]);

  const { startDate, endDate } = useMemo(() => rangeToIsoDates(range), [range]);

  useEffect(() => {
    if (!applierReady) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [dailyRows, summaryRows, freqRows, counts, docs, applyRuns] = await Promise.all([
          fetchDailyApplications(applierName, startDate, endDate),
          fetchJobSourceSummary(applierName, startDate, endDate),
          fetchJobApplicationFrequency(applierName, startDate, endDate),
          fetchJobStatusCounts(applierName),
          fetchAppliedJobDocs(applierName),
          fetchApplyRuns(applierName, 200),
        ]);
        if (cancelled) return;
        setDaily(dailyRows);
        setSourceSummary(summaryRows);
        setFrequency(freqRows);
        setStatusCounts(counts);
        setJobDocs(docs);
        setRuns(applyRuns);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applierName, applierReady, startDate, endDate]);

  return useMemo(() => {
    if (!applierReady || loading) return { ...EMPTY, loading: true, ready: applierReady };

    const totals = sumSourceTotals(sourceSummary);
    const applications = sumAppliedInRange(daily) || totals.applied;
    const responseRate = totals.applied > 0 ? Math.round((totals.scheduled / totals.applied) * 100) : 0;
    const interviewRate = responseRate;

    return {
      loading: false,
      ready: true,
      applications,
      responseRate,
      interviewRate,
      avgResponseDays: computeAvgResponseDays(jobDocs, applierId, startDate, endDate),
      posted: statusCounts.posted ?? totals.postings,
      agentRuns: runs.filter((r) => {
        const t = new Date(r.startedAt).getTime();
        return t >= new Date(startDate).getTime() && t <= new Date(endDate).getTime();
      }).length,
      trendData: computeTrend(daily, jobDocs, applierId, startDate, endDate),
      rolePie: computeRolePie(jobDocs, applierId, startDate, endDate),
      heatmapData: computeHeatmap(frequency, runs, startDate, endDate),
      sourceData: computeSourceRows(sourceSummary),
      funnel: computeFunnel(statusCounts),
      stageOverTime: computeStageOverTime(daily, jobDocs, applierId, startDate, endDate),
      velocitySeries: computeVelocitySeries(jobDocs, applierId, startDate, endDate),
      cohortData: computeCohort(daily, jobDocs, applierId, startDate, endDate),
      agentStatusPie: computeAgentStatusPie(runs, startDate, endDate),
      matchScatter: computeMatchScatter(jobDocs, applierId, startDate, endDate),
      pipelineBySource: sourceSummary.filter((r) => r.applied > 0 || r.postings > 0),
    };
  }, [
    applierReady,
    applierId,
    daily,
    endDate,
    frequency,
    jobDocs,
    loading,
    runs,
    sourceSummary,
    startDate,
    statusCounts,
  ]);
}

import { useEffect, useMemo, useState } from "react";
import { useApplier } from "@/context/applier-context";
import {
  fetchDailyApplications,
  fetchJobSourceSummary,
  type DailyApplicationRow,
  type JobSourceSummaryRow,
} from "../../../api/reports";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import { rangeToIsoDates } from "../lib/dateRange";
import {
  computeFunnel,
  computeSourceRows,
  computeTrend,
  sumAppliedInRange,
  sumSourceTotals,
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
  postingSources: number;
  trendData: TrendPoint[];
  rolePie: RoleSlice[];
  heatmapData: HeatmapRow[];
  sourceData: SourceRow[];
  funnel: FunnelItem[];
  stageOverTime: StageOverTime[];
  velocitySeries: VelocityPoint[];
  cohortData: CohortPoint[];
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
  postingSources: 0,
  trendData: [],
  rolePie: [],
  heatmapData: [],
  sourceData: [],
  funnel: [],
  stageOverTime: [],
  velocitySeries: [],
  cohortData: [],
  matchScatter: [],
  pipelineBySource: [],
};

export function useJobAnalytics(range: DateRange): JobAnalytics {
  const { applier, applierReady } = useApplier();
  const applierName = applier?.name;

  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DailyApplicationRow[]>([]);
  const [sourceSummary, setSourceSummary] = useState<JobSourceSummaryRow[]>([]);

  const { startDate, endDate } = useMemo(() => rangeToIsoDates(range), [range]);

  useEffect(() => {
    if (!applierReady) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [dailyRows, summaryRows] = await Promise.all([
          fetchDailyApplications(applierName, startDate, endDate),
          fetchJobSourceSummary(applierName, startDate, endDate),
        ]);
        if (cancelled) return;
        setDaily(dailyRows);
        setSourceSummary(summaryRows);
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
      avgResponseDays: null,
      posted: totals.postings,
      postingSources: sourceSummary.filter((row) => row.postings > 0).length,
      trendData: computeTrend(daily, [], null, startDate, endDate),
      rolePie: [],
      heatmapData: [],
      sourceData: computeSourceRows(sourceSummary),
      funnel: computeFunnel({
        posted: totals.postings,
        applied: totals.applied,
        scheduled: totals.scheduled,
        declined: sourceSummary.reduce((sum, row) => sum + row.declined, 0),
      }),
      stageOverTime: [],
      velocitySeries: [],
      cohortData: [],
      matchScatter: [],
      pipelineBySource: sourceSummary.filter((r) => r.applied > 0 || r.postings > 0),
    };
  }, [
    applierReady,
    daily,
    endDate,
    loading,
    sourceSummary,
    startDate,
  ]);
}

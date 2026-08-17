import { useEffect, useMemo, useState } from "react";
import { useApplier } from "@/context/applier-context";
import {
  fetchDailyApplications,
  fetchDailyPostingsBySource,
  fetchJobSourceSummary,
  type DailyApplicationRow,
  type DailyPostingBySourceRow,
  type JobSourceSummaryRow,
} from "../../../api/reports";
import type { AnalyticsFilterState } from "../lib/analyticsFilters";
import {
  percentDelta,
  pointDelta,
  previousAnalyticsBounds,
  resolveAnalyticsBounds,
} from "../lib/dateRange";
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
import {
  pivotPostingsBySource,
  type PostingsAreaPoint,
} from "../lib/postingsAreaChart";

export type AnalyticsDelta = {
  posted: number | null;
  applications: number | null;
  postingSources: number | null;
  applyRate: number | null;
  interviews: number | null;
  interviewRate: number | null;
  declined: number | null;
};

export interface JobAnalytics {
  loading: boolean;
  ready: boolean;
  applications: number;
  responseRate: number;
  interviewRate: number;
  applyRate: number;
  interviews: number;
  declined: number;
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
  postingsArea: PostingsAreaPoint[];
  postingSourceKeys: string[];
  sourceFiltered: boolean;
  deltas: AnalyticsDelta | null;
}

const EMPTY: JobAnalytics = {
  loading: true,
  ready: false,
  applications: 0,
  responseRate: 0,
  interviewRate: 0,
  applyRate: 0,
  interviews: 0,
  declined: 0,
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
  postingsArea: [],
  postingSourceKeys: [],
  sourceFiltered: false,
  deltas: null,
};

function filterBySources<T extends { source: string }>(rows: T[], sources: string[]): T[] {
  if (!sources.length) return rows;
  const allowed = new Set(sources);
  return rows.filter((row) => allowed.has(row.source || "Other"));
}

function snapshotFromSummary(summary: JobSourceSummaryRow[]) {
  const totals = sumSourceTotals(summary);
  const applyRate = totals.postings > 0 ? Math.round((totals.applied / totals.postings) * 100) : 0;
  const interviewRate = totals.applied > 0 ? Math.round((totals.scheduled / totals.applied) * 100) : 0;
  return {
    posted: totals.postings,
    applications: totals.applied,
    postingSources: summary.filter((row) => row.postings > 0).length,
    applyRate,
    interviews: totals.scheduled,
    interviewRate,
    declined: totals.declined,
  };
}

export function useJobAnalytics(filters: AnalyticsFilterState): JobAnalytics {
  const { applier, applierReady } = useApplier();
  const applierName = applier?.name;

  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DailyApplicationRow[]>([]);
  const [sourceSummary, setSourceSummary] = useState<JobSourceSummaryRow[]>([]);
  const [previousSummary, setPreviousSummary] = useState<JobSourceSummaryRow[]>([]);
  const [postingRows, setPostingRows] = useState<DailyPostingBySourceRow[]>([]);

  const bounds = useMemo(() => resolveAnalyticsBounds(filters), [filters]);
  const previous = useMemo(() => previousAnalyticsBounds(bounds), [bounds]);
  const sourceKey = filters.source.join("|");
  const { startDate, endDate } = bounds;
  const previousStart = previous?.startDate ?? "";
  const previousEnd = previous?.endDate ?? "";

  useEffect(() => {
    if (!applierReady) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [dailyRows, summaryRows, postingBySource, previousRows] = await Promise.all([
          fetchDailyApplications(applierName, startDate, endDate),
          fetchJobSourceSummary(applierName, startDate, endDate),
          fetchDailyPostingsBySource(startDate, endDate),
          previousStart && previousEnd
            ? fetchJobSourceSummary(applierName, previousStart, previousEnd)
            : Promise.resolve([] as JobSourceSummaryRow[]),
        ]);
        if (cancelled) return;
        setDaily(dailyRows);
        setSourceSummary(summaryRows);
        setPostingRows(postingBySource);
        setPreviousSummary(previousRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applierName, applierReady, endDate, previousEnd, previousStart, startDate]);

  return useMemo(() => {
    if (!applierReady || loading) return { ...EMPTY, loading: true, ready: applierReady };

    const selectedSources = sourceKey ? sourceKey.split("|") : [];
    const summary = filterBySources(sourceSummary, selectedSources);
    const rows = filterBySources(postingRows, selectedSources);
    const totals = snapshotFromSummary(summary);
    const applications = selectedSources.length
      ? totals.applications
      : sumAppliedInRange(daily) || totals.applications;
    const { points, sources } = pivotPostingsBySource(
      rows,
      bounds.startDate,
      bounds.endDate,
    );
    const postingSources = totals.postingSources || sources.length;
    const previousSnap = previous
      ? snapshotFromSummary(filterBySources(previousSummary, selectedSources))
      : null;

    return {
      loading: false,
      ready: true,
      applications,
      responseRate: totals.interviewRate,
      interviewRate: totals.interviewRate,
      applyRate: totals.applyRate,
      interviews: totals.interviews,
      declined: totals.declined,
      avgResponseDays: null,
      posted: totals.posted,
      postingSources,
      trendData: selectedSources.length
        ? []
        : computeTrend(daily, [], null, bounds.startDate, bounds.endDate),
      rolePie: [],
      heatmapData: [],
      sourceData: computeSourceRows(summary),
      funnel: computeFunnel({
        posted: totals.posted,
        applied: applications,
        scheduled: totals.interviews,
        declined: totals.declined,
      }),
      stageOverTime: [],
      velocitySeries: [],
      cohortData: [],
      matchScatter: [],
      pipelineBySource: summary.filter((row) => row.applied > 0 || row.postings > 0),
      postingsArea: points,
      postingSourceKeys: sources,
      sourceFiltered: selectedSources.length > 0,
      deltas: previousSnap
        ? {
            posted: percentDelta(totals.posted, previousSnap.posted),
            applications: percentDelta(applications, previousSnap.applications),
            postingSources: percentDelta(postingSources, previousSnap.postingSources),
            applyRate: pointDelta(totals.applyRate, previousSnap.applyRate),
            interviews: percentDelta(totals.interviews, previousSnap.interviews),
            interviewRate: pointDelta(totals.interviewRate, previousSnap.interviewRate),
            declined: percentDelta(totals.declined, previousSnap.declined),
          }
        : null,
    };
  }, [
    applierReady,
    bounds.endDate,
    bounds.startDate,
    daily,
    loading,
    postingRows,
    previous,
    previousSummary,
    sourceKey,
    sourceSummary,
  ]);
}

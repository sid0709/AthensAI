import React, { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTip } from "../../../components/ui";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { analyticsJobSearchHref } from "../lib/analyticsJobSearch";
import type { AnalyticsDateBounds } from "../lib/dateRange";
import { sourcePeriodTotals } from "../lib/postingsAreaChart";
import { AnalyticsEmpty } from "./AnalyticsStates";
import { AnalyticsMetric, AnalyticsSurfaceCard } from "./AnalyticsMetric";

const TOTAL_FILL = "var(--athens-selected)";
const TOTAL_STROKE = "var(--athens-text-muted)";
const FOCUS_FILL = "var(--athens-brand-subtle)";
const FOCUS_STROKE = "var(--athens-brand)";

function PostingsTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>;
  label?: string | number;
}) {
  return (
    <ChartTip
      active={active}
      payload={payload}
      label={label}
      hideZero
    />
  );
}

export function JobPostingProgress({
  caption,
  analytics,
  bounds,
}: {
  caption: string;
  analytics: JobAnalytics;
  bounds: AnalyticsDateBounds;
}) {
  const [focusSource, setFocusSource] = useState<string | null>(null);
  const applyRate =
    analytics.posted > 0
      ? Math.round((analytics.applications / analytics.posted) * 100)
      : 0;

  const ranked = useMemo(
    () => sourcePeriodTotals(analytics.postingsArea, analytics.postingSourceKeys),
    [analytics.postingsArea, analytics.postingSourceKeys],
  );

  const hasSeries = analytics.postingsArea.some((row) => Number(row.total) > 0);
  const periodTotal = ranked.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--athens-text-muted)]">
        {caption}
        {analytics.deltas ? " · vs previous period" : ""}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AnalyticsMetric
          label="New postings"
          value={analytics.posted.toLocaleString()}
          sub="in this period"
          delta={analytics.deltas?.posted}
        />
        <AnalyticsMetric
          label="Active sources"
          value={String(analytics.postingSources)}
          sub="sources with postings"
          delta={analytics.deltas?.postingSources}
        />
        <AnalyticsMetric
          label="Applied"
          value={analytics.applications.toLocaleString()}
          sub="from available postings"
          delta={analytics.deltas?.applications}
        />
        <AnalyticsMetric
          label="Posting apply rate"
          value={analytics.posted > 0 ? `${applyRate}%` : "—"}
          sub="applications ÷ postings"
          delta={analytics.posted > 0 ? analytics.deltas?.applyRate : null}
          deltaKind="points"
        />
      </div>

      <AnalyticsSurfaceCard
        title="Postings over time"
        subtitle={
          focusSource
            ? `${focusSource} against all postings`
            : "Daily volume · click a source below to overlay it"
        }
      >
        {!hasSeries ? (
          <AnalyticsEmpty message="No job postings were recorded in this date range." />
        ) : (
          <div className="space-y-6">
            <div className="overflow-visible">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart
                  data={analytics.postingsArea}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="rgb(13 13 13 / 6%)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--athens-text-muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--athens-text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    content={<PostingsTip />}
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 40, outline: "none" }}
                    cursor={{ stroke: "var(--athens-border-strong)", strokeWidth: 1 }}
                  />
                  {focusSource ? (
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="All postings"
                      stroke={TOTAL_STROKE}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : (
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="All postings"
                      stroke={TOTAL_STROKE}
                      strokeWidth={1.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill={TOTAL_FILL}
                      fillOpacity={1}
                      isAnimationActive={false}
                    />
                  )}
                  {focusSource ? (
                    <Area
                      type="monotone"
                      dataKey={focusSource}
                      name={focusSource}
                      stroke={FOCUS_STROKE}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill={FOCUS_FILL}
                      fillOpacity={1}
                      isAnimationActive={false}
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--athens-text-secondary)]">
              <li className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: TOTAL_STROKE }}
                  aria-hidden
                />
                All postings
              </li>
              {focusSource ? (
                <li className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: FOCUS_STROKE }}
                    aria-hidden
                  />
                  {focusSource}
                </li>
              ) : null}
            </ul>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--athens-text-muted)]">
                  All sources
                </p>
                <p className="text-xs text-[var(--athens-text-muted)] tabular-nums">
                  {ranked.length} sources · {periodTotal.toLocaleString()} postings
                </p>
              </div>
              <ul className="max-h-[320px] overflow-y-auto rounded-[var(--athens-radius-md)] border border-[var(--athens-border)] bg-[var(--athens-surface-subtle)]">
                {ranked.map((row) => {
                  const selected = focusSource === row.source;
                  const pct = Math.round(row.share * 1000) / 10;
                  const href = analyticsJobSearchHref({
                    source: row.source,
                    startDay: bounds.startDay,
                    endDay: bounds.endDay,
                  });
                  return (
                    <li key={row.source}>
                      <div
                        className={`flex w-full items-center gap-3 rounded-[var(--athens-radius-md)] px-3 py-2.5 ${
                          selected
                            ? "bg-[var(--athens-selected)]"
                            : "hover:bg-[var(--athens-hover)]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setFocusSource((prev) =>
                              prev === row.source ? null : row.source,
                            )
                          }
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-pressed={selected}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: selected
                                ? "var(--athens-brand)"
                                : "var(--athens-border-strong)",
                            }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-[var(--athens-text)]">
                            {row.source}
                          </span>
                          <span className="w-16 text-right text-xs text-[var(--athens-text-secondary)] tabular-nums">
                            {pct}%
                          </span>
                          <span className="w-14 text-right text-sm font-semibold text-[var(--athens-text)] tabular-nums">
                            {row.count.toLocaleString()}
                          </span>
                          <span className="hidden sm:block w-24 h-1.5 rounded-full bg-[var(--athens-border)] overflow-hidden">
                            <span
                              className="block h-full rounded-full bg-[var(--athens-text)]"
                              style={{
                                width: `${Math.max(2, row.share * 100)}%`,
                                opacity: selected ? 1 : 0.35,
                              }}
                            />
                          </span>
                        </button>
                        {href ? (
                          <Link
                            to={href}
                            className="athens-icon-btn shrink-0 no-underline"
                            aria-label={`View ${row.source} in Job Search`}
                            title="View in Job Search"
                          >
                            <ArrowUpRight size={16} aria-hidden="true" />
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {focusSource ? (
                <p className="mt-2 text-xs text-[var(--athens-text-muted)]">
                  Showing {focusSource} on the chart. Click again to clear.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </AnalyticsSurfaceCard>
    </div>
  );
}

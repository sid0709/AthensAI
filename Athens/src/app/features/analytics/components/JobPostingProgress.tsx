import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTip } from "../../../components/ui";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import {
  lensSeriesColor,
  POSTINGS_CHART_TOP_N,
  sourcePeriodTotals,
  toTopNOtherSeries,
} from "../lib/postingsAreaChart";
import { rangeLabel } from "../lib/rangeFilter";
import { AnalyticsEmpty } from "./AnalyticsStates";

function QuietMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-[#dedede] bg-white px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8e8e8e]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-[#0d0d0d] tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 text-xs text-[#8e8e8e]">{sub}</p>
    </div>
  );
}

function PostingsTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>;
  label?: string | number;
}) {
  const total =
    payload?.reduce((sum, p) => sum + (Number(p.value) || 0), 0) ?? null;
  return (
    <ChartTip
      active={active}
      payload={payload}
      label={label}
      scrollable
      hideZero
      sortByValue
      total={total}
      maxHeight={280}
    />
  );
}

export function JobPostingProgress({
  range,
  analytics,
}: {
  range: DateRange;
  analytics: JobAnalytics;
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

  const chart = useMemo(
    () =>
      toTopNOtherSeries(
        analytics.postingsArea,
        analytics.postingSourceKeys,
        POSTINGS_CHART_TOP_N,
        focusSource,
      ),
    [analytics.postingsArea, analytics.postingSourceKeys, focusSource],
  );

  const hasSeries = analytics.postingsArea.some((row) => Number(row.total) > 0);
  const periodTotal = ranked.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-5">
      <p className="text-xs text-[#8e8e8e]">
        Job posting progress for {rangeLabel(range)}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuietMetric
          label="New postings"
          value={String(analytics.posted)}
          sub="in this period"
        />
        <QuietMetric
          label="Active sources"
          value={String(analytics.postingSources)}
          sub="sources with postings"
        />
        <QuietMetric
          label="Applied"
          value={String(analytics.applications)}
          sub="from available postings"
        />
        <QuietMetric
          label="Posting apply rate"
          value={analytics.posted > 0 ? `${applyRate}%` : "—"}
          sub="applications ÷ postings"
        />
      </div>

      <div className="rounded-xl border border-[#dedede] bg-white p-6">
        <div className="mb-5">
          <h3 className="text-sm font-semibold tracking-tight text-[#0d0d0d]">
            Postings by source
          </h3>
          <p className="mt-1 text-sm text-[#5d5d5d]">
            Top sources over time · full breakdown below
          </p>
        </div>

        {!hasSeries ? (
          <AnalyticsEmpty message="No job postings were recorded in this date range." />
        ) : (
          <div className="space-y-6">
            <div className="overflow-visible">
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart
                  data={chart.points}
                  margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
                >
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="rgba(13,13,13,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#8e8e8e", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "#8e8e8e", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<PostingsTip />}
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 40, outline: "none" }}
                    cursor={{ stroke: "#c7c7c7", strokeWidth: 1 }}
                  />
                  {chart.series.map((source, index) => {
                    const color = lensSeriesColor(source, index, chart.series);
                    const focused = focusSource != null && source === focusSource;
                    const dimmed = focusSource != null && source !== focusSource;
                    return (
                      <Area
                        key={source}
                        type="monotone"
                        dataKey={source}
                        name={source}
                        stackId="postings"
                        stroke={color}
                        fill={color}
                        fillOpacity={
                          focusSource == null ? 0.55 : focused ? 0.75 : dimmed ? 0.18 : 0.45
                        }
                        strokeWidth={focused ? 2 : 1.25}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8e8e8e]">
                  All sources
                </p>
                <p className="text-xs text-[#8e8e8e] tabular-nums">
                  {ranked.length} sources · {periodTotal.toLocaleString()} postings
                </p>
              </div>
              <ul className="max-h-[320px] overflow-y-auto rounded-xl border border-[#dedede] bg-[#f7f7f7]/p-1">
                {ranked.map((row) => {
                  const selected = focusSource === row.source;
                  const pct = Math.round(row.share * 1000) / 10;
                  return (
                    <li key={row.source}>
                      <button
                        type="button"
                        onClick={() =>
                          setFocusSource((prev) =>
                            prev === row.source ? null : row.source,
                          )
                        }
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 ${
                          selected
                            ? "bg-[rgb(13_13_13_/9%)]"
                            : "hover:bg-[rgb(13_13_13_/6%)]"
                        }`}
                        aria-pressed={selected}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: selected
                              ? "#1f6feb"
                              : chart.series.includes(row.source)
                                ? lensSeriesColor(
                                    row.source,
                                    chart.series.indexOf(row.source),
                                    chart.series,
                                  )
                                : "#c7c7c7",
                          }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-[#0d0d0d]">
                          {row.source}
                        </span>
                        <span className="w-16 text-right text-xs text-[#5d5d5d] tabular-nums">
                          {pct}%
                        </span>
                        <span className="w-14 text-right text-sm font-semibold text-[#0d0d0d] tabular-nums">
                          {row.count.toLocaleString()}
                        </span>
                        <span className="hidden sm:block w-24 h-1.5 rounded-full bg-[#dedede] overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-[#1f6feb]"
                            style={{
                              width: `${Math.max(2, row.share * 100)}%`,
                              opacity: selected ? 1 : 0.55,
                            }}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {focusSource && (
                <p className="mt-2 text-xs text-[#8e8e8e]">
                  Focusing {focusSource}. Click again to clear.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

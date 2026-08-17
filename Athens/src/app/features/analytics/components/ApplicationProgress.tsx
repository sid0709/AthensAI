import React from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTip } from "../../../components/ui";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { analyticsJobSearchHref } from "../lib/analyticsJobSearch";
import type { AnalyticsDateBounds } from "../lib/dateRange";
import { AnalyticsEmpty, analyticsTrendSubtitle } from "./AnalyticsStates";
import { AnalyticsFunnel } from "./AnalyticsFunnel";
import { AnalyticsMetric, AnalyticsSurfaceCard } from "./AnalyticsMetric";

export function ApplicationProgress({
  caption,
  analytics,
  bounds,
}: {
  caption: string;
  analytics: JobAnalytics;
  bounds: AnalyticsDateBounds;
}) {
  const maxRate = Math.max(...analytics.sourceData.map((row) => row.rate), 1);

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--athens-text-muted)]">
        {caption}
        {analytics.deltas ? " · vs previous period" : ""}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AnalyticsMetric
          label="Applications"
          value={analytics.applications.toLocaleString()}
          sub="sent in this period"
          delta={analytics.deltas?.applications}
        />
        <AnalyticsMetric
          label="Interviews"
          value={analytics.interviews.toLocaleString()}
          sub="scheduled in this period"
          delta={analytics.deltas?.interviews}
        />
        <AnalyticsMetric
          label="Interview rate"
          value={analytics.applications > 0 ? `${analytics.interviewRate}%` : "—"}
          sub="scheduled ÷ applications"
          delta={analytics.applications > 0 ? analytics.deltas?.interviewRate : null}
          deltaKind="points"
        />
        <AnalyticsMetric
          label="Declined"
          value={analytics.declined.toLocaleString()}
          sub="recorded in this period"
          delta={analytics.deltas?.declined}
        />
      </div>

      <div className={`grid grid-cols-1 gap-3 ${analytics.sourceFiltered ? "" : "lg:grid-cols-2"}`}>
        {!analytics.sourceFiltered ? (
          <AnalyticsSurfaceCard
            title="Application activity"
            subtitle={analyticsTrendSubtitle(analytics)}
          >
            {analytics.trendData.length === 0 ? (
              <AnalyticsEmpty message="No application activity in this date range." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart
                  data={analytics.trendData}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="rgb(13 13 13 / 6%)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="m"
                    tick={{ fill: "var(--athens-text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--athens-text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTip />} />
                  <Bar
                    dataKey="apps"
                    name="Applied"
                    fill="var(--athens-brand)"
                    fillOpacity={0.72}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </AnalyticsSurfaceCard>
        ) : null}

        <AnalyticsSurfaceCard
          title="Application funnel"
          subtitle="Progress through each stage in this period"
        >
          {analytics.funnel.length === 0 ? (
            <AnalyticsEmpty message="No pipeline data yet — apply to jobs to build your funnel." />
          ) : (
            <AnalyticsFunnel items={analytics.funnel} />
          )}
        </AnalyticsSurfaceCard>
      </div>

      <AnalyticsSurfaceCard
        title="Interview rate by source"
        subtitle="Which channels convert applications to interviews"
      >
        {analytics.sourceData.length === 0 ? (
          <AnalyticsEmpty message="No applications by source in this period." />
        ) : (
          <ul className="space-y-4">
            {[...analytics.sourceData]
              .sort((a, b) => b.rate - a.rate || b.apps - a.apps)
              .map((row) => {
                const href = analyticsJobSearchHref({
                  source: row.src,
                  startDay: bounds.startDay,
                  endDay: bounds.endDay,
                  status: "applied",
                });
                return (
                  <li key={row.src} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-[var(--athens-text)]">
                          {row.src}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-[var(--athens-text)]">
                          {row.rate}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--athens-border)]">
                        <div
                          className="h-full rounded-full bg-[var(--athens-brand)]"
                          style={{ width: `${Math.max(2, (row.rate / maxRate) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-[var(--athens-text-muted)] tabular-nums">
                        {row.responses.toLocaleString()} interviews from {row.apps.toLocaleString()} applications
                      </p>
                    </div>
                    {href ? (
                      <Link
                        to={href}
                        className="athens-icon-btn mt-0.5 shrink-0 no-underline"
                        aria-label={`View ${row.src} applications in Job Search`}
                        title="View in Job Search"
                      >
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        )}
      </AnalyticsSurfaceCard>
    </div>
  );
}

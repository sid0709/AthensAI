import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ChartTip } from "../../../components/ui";
import { mono } from "../../../lib/utils";
import { AnalyticsChartCard } from "./AnalyticsHeatmap";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import { rangeLabel } from "../lib/rangeFilter";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { AnalyticsEmpty } from "./AnalyticsStates";

export function AnalyticsSourcesTab({
  range = "30d",
  analytics,
}: {
  range?: DateRange;
  analytics: JobAnalytics;
}) {
  const sourceData = analytics.sourceData;
  const maxRate = Math.max(...sourceData.map((s) => s.rate), 1);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Showing data for {rangeLabel(range)}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-1">Applications by Source</h3>
          <p className="text-sm text-muted-foreground mb-5">Volume vs interview responses — channel quality</p>
          {sourceData.length === 0 ? (
            <AnalyticsEmpty message="No applications by source in this period." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sourceData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="src" tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                <Bar dataKey="apps" name="Applied" fill="#6c5ce7" opacity={0.7} radius={[4, 4, 0, 0]} />
                <Bar dataKey="responses" name="Interviews" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-1">Interview Rate by Source</h3>
          <p className="text-sm text-muted-foreground mb-5">Which channels work best for you</p>
          {sourceData.length === 0 ? (
            <AnalyticsEmpty message="No source performance data yet." />
          ) : (
            <div className="space-y-5 mt-2">
              {[...sourceData].sort((a, b) => b.rate - a.rate).map((s) => (
                <div key={s.src}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-foreground">{s.src}</span>
                    <span className="text-sm font-bold text-foreground" style={mono}>
                      {s.rate}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${(s.rate / maxRate) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.responses} interviews from {s.apps} applications
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <AnalyticsChartCard title="Pipeline by source" subtitle="Posted, applied, and interview stages">
          {analytics.pipelineBySource.length === 0 ? (
            <AnalyticsEmpty message="No pipeline data by source." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={analytics.pipelineBySource.slice(0, 8)}
                margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              >
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="source" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="postings" name="Posted" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="applied" name="Applied" fill="#6c5ce7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="scheduled" name="Interview" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartCard>
      </div>
    </div>
  );
}

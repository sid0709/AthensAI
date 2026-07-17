import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { FunnelBars } from "../../../components/shared/FunnelBars";
import { ChartTip } from "../../../components/ui";
import { AnalyticsChartCard } from "./AnalyticsHeatmap";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import { rangeLabel } from "../lib/rangeFilter";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { AnalyticsEmpty } from "./AnalyticsStates";

export function AnalyticsFunnelTab({
  range = "30d",
  analytics,
}: {
  range?: DateRange;
  analytics: JobAnalytics;
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Showing data for {rangeLabel(range)} · pipeline counts are all-time</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-1">Your Application Funnel</h3>
          <p className="text-sm text-muted-foreground mb-6">Conversion through each stage</p>
          {analytics.funnel.length === 0 ? (
            <AnalyticsEmpty message="No pipeline data yet — save or apply to jobs to build your funnel." />
          ) : (
            <FunnelBars items={analytics.funnel} barHeight="h-3" valueSize="md" />
          )}
        </div>
        <AnalyticsChartCard title="Stage volume over time" subtitle="Monthly progression through pipeline">
          {analytics.stageOverTime.length === 0 ? (
            <AnalyticsEmpty message="No stage history in this period." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={analytics.stageOverTime}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="m" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="applied" stackId="1" stroke="#6c5ce7" fill="#6c5ce7" fillOpacity={0.5} />
                <Area type="monotone" dataKey="screening" stackId="1" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.5} />
                <Area type="monotone" dataKey="interview" stackId="1" stroke="#f472b6" fill="#f472b6" fillOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartCard>
      </div>
    </div>
  );
}

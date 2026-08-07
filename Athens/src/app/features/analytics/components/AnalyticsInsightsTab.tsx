import React from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartTip } from "../../../components/ui";
import { AnalyticsChartCard } from "./AnalyticsHeatmap";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import { rangeLabel } from "../lib/rangeFilter";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { AnalyticsEmpty } from "./AnalyticsStates";

export function AnalyticsInsightsTab({
  range = "30d",
  analytics,
}: {
  range?: DateRange;
  analytics: JobAnalytics;
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Showing data for {rangeLabel(range)}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AnalyticsChartCard title="Match score vs outcome" subtitle="Applied jobs — higher match vs interview scheduled">
          {analytics.matchScatter.length === 0 ? (
            <AnalyticsEmpty message="Apply to scored jobs to see match vs outcome." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  type="number"
                  dataKey="match"
                  name="Match %"
                  tick={{ fill: "#6b6b84", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="likelihood"
                  name="Outcome"
                  tick={{ fill: "#6b6b84", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTip />} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={analytics.matchScatter} fill="#2dd4bf" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartCard>
      </div>
    </div>
  );
}

import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
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
  const agentRunsByDay = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const slice of analytics.agentStatusPie) {
      map.set(slice.name, slice.v);
    }
    return [...map.entries()].map(([name, v]) => ({ name, runs: v }));
  }, [analytics.agentStatusPie]);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Showing data for {rangeLabel(range)}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AnalyticsChartCard title="Agent run outcomes" subtitle="Auto-apply runs by status">
          {analytics.agentStatusPie.length === 0 ? (
            <AnalyticsEmpty message="No agent runs in this period. Use Agents to auto-apply." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={analytics.agentStatusPie}
                    dataKey="v"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {analytics.agentStatusPie.map((e) => (
                      <Cell key={e.name} fill={e.c} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2">
                {analytics.agentStatusPie.map((d) => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.c }} />
                    {d.name} {d.v}%
                  </span>
                ))}
              </div>
            </>
          )}
        </AnalyticsChartCard>
        <AnalyticsChartCard title="Agent activity" subtitle={`${analytics.agentRuns} runs in period`}>
          {agentRunsByDay.length === 0 ? (
            <AnalyticsEmpty message="No agent usage recorded." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={agentRunsByDay} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#6b6b84", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="runs" name="Share (%)" fill="#6c5ce7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartCard>
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

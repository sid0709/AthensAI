import React from "react";
import { BarChart3, BriefcaseBusiness, Send, Waypoints } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTip, KPI } from "../../../components/ui";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { sourceChartColor } from "../lib/postingsAreaChart";
import { rangeLabel } from "../lib/rangeFilter";
import { AnalyticsEmpty } from "./AnalyticsStates";

export function JobPostingProgress({ range, analytics }: { range: DateRange; analytics: JobAnalytics }) {
  const applyRate = analytics.posted > 0
    ? Math.round((analytics.applications / analytics.posted) * 100)
    : 0;
  const hasSeries = analytics.postingsArea.some((row) => Number(row.total) > 0);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Job posting progress for {rangeLabel(range)}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="New postings" value={String(analytics.posted)} sub="in this period" icon={BriefcaseBusiness} accent="violet" />
        <KPI label="Active sources" value={String(analytics.postingSources)} sub="sources with postings" icon={Waypoints} accent="blue" />
        <KPI label="Applied" value={String(analytics.applications)} sub="from available postings" icon={Send} accent="emerald" />
        <KPI label="Posting apply rate" value={analytics.posted > 0 ? `${applyRate}%` : "—"} sub="applications ÷ postings" icon={BarChart3} accent="amber" />
      </div>

      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-foreground mb-1">Postings by source</h3>
        <p className="text-sm text-muted-foreground mb-5">New opportunities over time by job source</p>
        {!hasSeries ? (
          <AnalyticsEmpty message="No job postings were recorded in this date range." />
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <AreaChart data={analytics.postingsArea} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#6b6b84", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#6b6b84", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTip />} />
              <Legend
                verticalAlign="top"
                align="left"
                iconType="circle"
                wrapperStyle={{
                  fontSize: 11,
                  paddingBottom: 12,
                  lineHeight: "22px",
                  maxHeight: 96,
                  overflow: "auto",
                }}
              />
              {analytics.postingSourceKeys.map((source, index) => {
                const color = sourceChartColor(source, index);
                return (
                  <Area
                    key={source}
                    type="monotone"
                    dataKey={source}
                    name={source}
                    stackId="postings"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.72}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

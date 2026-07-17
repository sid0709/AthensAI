import React from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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

export function AnalyticsVelocityTab({
  range = "30d",
  analytics,
}: {
  range?: DateRange;
  analytics: JobAnalytics;
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Showing data for {rangeLabel(range)}</p>
      <AnalyticsChartCard title="Time-to-response trend" subtitle="Days from application to interview scheduled">
        {analytics.velocitySeries.length === 0 ? (
          <AnalyticsEmpty message="Need applications with scheduled interviews to compute velocity." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={analytics.velocitySeries}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="w" tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="response" name="Response (days)" stroke="#6c5ce7" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </AnalyticsChartCard>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AnalyticsChartCard title="Interviews per week" subtitle="Scheduled interviews from applications">
          {analytics.velocitySeries.length === 0 ? (
            <AnalyticsEmpty message="No weekly interview data." />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={analytics.velocitySeries}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="w" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="interview" name="Interviews" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartCard>
        <AnalyticsChartCard title="Cohort conversion" subtitle="Applied → screening → interview">
          {analytics.cohortData.length === 0 ? (
            <AnalyticsEmpty message="No cohort data in this period." />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={analytics.cohortData}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="m" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="c2" name="Screening %" stroke="#2dd4bf" strokeWidth={2} />
                <Line type="monotone" dataKey="c3" name="Interview %" stroke="#6c5ce7" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </AnalyticsChartCard>
      </div>
    </div>
  );
}

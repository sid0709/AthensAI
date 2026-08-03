import React from "react";
import { CheckCircle, CircleX, Send, TrendingUp } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FunnelBars } from "../../../components/shared/FunnelBars";
import { ChartTip, KPI } from "../../../components/ui";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { rangeLabel } from "../lib/rangeFilter";
import { AnalyticsEmpty, analyticsTrendSubtitle } from "./AnalyticsStates";

export function ApplicationProgress({ range, analytics }: { range: DateRange; analytics: JobAnalytics }) {
  const declined = analytics.funnel.find((item) => item.s === "Declined")?.n ?? 0;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Your application progress for {rangeLabel(range)}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Applications" value={String(analytics.applications)} sub="sent in this period" icon={Send} accent="violet" />
        <KPI label="Interviews" value={String(analytics.funnel.find((item) => item.s === "Interview")?.n ?? 0)} sub="scheduled in this period" icon={CheckCircle} accent="emerald" />
        <KPI label="Interview rate" value={analytics.applications > 0 ? `${analytics.interviewRate}%` : "—"} sub="for this period" icon={TrendingUp} accent="blue" />
        <KPI label="Declined" value={String(declined)} sub="recorded in this period" icon={CircleX} accent="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-1">Application activity</h3>
          <p className="text-sm text-muted-foreground mb-5">{analyticsTrendSubtitle(analytics)}</p>
          {analytics.trendData.length === 0 ? (
            <AnalyticsEmpty message="No application activity in this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={analytics.trendData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="m" tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="apps" name="Applied" fill="#6c5ce7" opacity={0.85} radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-1">Application funnel</h3>
          <p className="text-sm text-muted-foreground mb-6">Progress through each stage in this period</p>
          <FunnelBars items={analytics.funnel} barHeight="h-3" valueSize="md" />
        </div>
      </div>
    </div>
  );
}

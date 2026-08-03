import React from "react";
import { BarChart3, BriefcaseBusiness, Send, Waypoints } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTip, KPI } from "../../../components/ui";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import type { JobAnalytics } from "../hooks/useJobAnalytics";
import { rangeLabel } from "../lib/rangeFilter";
import { AnalyticsEmpty } from "./AnalyticsStates";

export function JobPostingProgress({ range, analytics }: { range: DateRange; analytics: JobAnalytics }) {
  const applyRate = analytics.posted > 0
    ? Math.round((analytics.applications / analytics.posted) * 100)
    : 0;
  const sourceData = analytics.pipelineBySource
    .filter((row) => row.postings > 0)
    .sort((a, b) => b.postings - a.postings);

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
        <p className="text-sm text-muted-foreground mb-5">New opportunities compared with applications sent</p>
        {sourceData.length === 0 ? (
          <AnalyticsEmpty message="No job postings were recorded in this date range." />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sourceData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="source" tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "#6b6b84", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="postings" name="Postings" fill="#6c5ce7" radius={[4, 4, 0, 0]} />
              <Bar dataKey="applied" name="Applied" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

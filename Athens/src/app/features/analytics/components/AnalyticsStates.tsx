import React from "react";
import type { JobAnalytics } from "../hooks/useJobAnalytics";

export function AnalyticsLoading({ label = "Loading analytics…" }: { label?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function AnalyticsEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function AnalyticsProfileGate({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  if (!ready) {
    return <AnalyticsEmpty message="Select a profile in Settings to view your job search analytics." />;
  }
  return <>{children}</>;
}

export function analyticsTrendSubtitle(data: JobAnalytics): string {
  if (data.trendData.length === 0) return "No applications in this period";
  const first = data.trendData[0]?.m;
  const last = data.trendData[data.trendData.length - 1]?.m;
  return first === last ? `Submissions & responses — ${first}` : `Submissions & responses — ${first} to ${last}`;
}

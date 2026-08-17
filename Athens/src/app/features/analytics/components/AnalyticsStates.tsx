import React from "react";
import type { JobAnalytics } from "../hooks/useJobAnalytics";

export function AnalyticsLoading({ label = "Loading analytics…" }: { label?: string }) {
  return (
    <div className="athens-surface p-8 text-center text-sm text-[var(--athens-text-secondary)]">
      {label}
    </div>
  );
}

export function AnalyticsEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--athens-radius-md)] border border-dashed border-[var(--athens-border)] bg-[var(--athens-surface-subtle)] p-8 text-center text-sm text-[var(--athens-text-secondary)]">
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
  return first === last ? `Applications — ${first}` : `Applications — ${first} to ${last}`;
}

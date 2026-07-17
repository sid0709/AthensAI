import React from "react";
import { cn } from "../../../lib/utils";
import type { HeatmapRow } from "../lib/computeAnalytics";
import { AnalyticsEmpty } from "./AnalyticsStates";

const HOURS = ["h6", "h9", "h12", "h15", "h18", "h21"] as const;
const LABELS = ["6a", "9a", "12p", "3p", "6p", "9p"];

function heatColor(v: number, max: number): string {
  const ratio = max > 0 ? v / max : 0;
  if (ratio >= 0.85) return "bg-violet-600";
  if (ratio >= 0.6) return "bg-violet-500/70";
  if (ratio >= 0.35) return "bg-violet-400/50";
  if (ratio >= 0.1) return "bg-violet-300/40";
  return "bg-secondary";
}

export function AnalyticsHeatmap({ data }: { data: HeatmapRow[] }) {
  const max = React.useMemo(() => {
    let m = 0;
    for (const row of data) {
      for (const h of HOURS) m = Math.max(m, row[h]);
    }
    return m;
  }, [data]);

  const rows = data.filter((r) => r.day !== "Sun");

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground mb-1">Activity by weekday & hour</h3>
      <p className="text-xs text-muted-foreground mb-4">Applications and agent runs combined</p>
      {rows.length === 0 || max === 0 ? (
        <AnalyticsEmpty message="No apply activity recorded in this period." />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[320px]">
            <div className="grid grid-cols-[40px_repeat(6,1fr)] gap-1 mb-1">
              <div />
              {LABELS.map((l) => (
                <div key={l} className="text-[10px] text-center text-muted-foreground font-semibold">
                  {l}
                </div>
              ))}
            </div>
            {rows.map((row) => (
              <div key={row.day} className="grid grid-cols-[40px_repeat(6,1fr)] gap-1 mb-1">
                <div className="text-xs text-muted-foreground font-semibold flex items-center">{row.day}</div>
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className={cn("h-8 rounded-md", heatColor(row[h], max))}
                    title={`${row.day} ${h}: ${row[h]} activities`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalyticsChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

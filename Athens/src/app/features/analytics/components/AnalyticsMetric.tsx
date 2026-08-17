import React from "react";

export function AnalyticsMetric({
  label,
  value,
  sub,
  delta,
  deltaKind = "percent",
}: {
  label: string;
  value: string;
  sub: string;
  delta?: number | null;
  deltaKind?: "percent" | "points";
}) {
  const deltaLabel =
    delta == null
      ? null
      : delta === 0
        ? "same as prior"
        : `${delta > 0 ? "+" : ""}${delta}${deltaKind === "points" ? " pts" : "%"} vs prior`;

  return (
    <div className="athens-surface px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--athens-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-[var(--athens-text)] tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 text-xs text-[var(--athens-text-muted)]">{sub}</p>
      {deltaLabel ? (
        <p className="mt-1 text-xs tabular-nums text-[var(--athens-text-secondary)]">{deltaLabel}</p>
      ) : null}
    </div>
  );
}

export function AnalyticsSurfaceCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="athens-surface p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-[var(--athens-text)]">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-1 text-sm text-[var(--athens-text-secondary)]">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

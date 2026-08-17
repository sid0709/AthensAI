import React from "react";

type FunnelItem = { s: string; n: number; p: number };

export function AnalyticsFunnel({ items }: { items: FunnelItem[] }) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={item.s}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--athens-text-secondary)]">{item.s}</span>
            <div className="flex items-center gap-2 tabular-nums">
              <span className="text-sm font-semibold text-[var(--athens-text)]">
                {item.n.toLocaleString()}
              </span>
              <span className="text-xs text-[var(--athens-text-muted)]">{item.p}%</span>
            </div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-[var(--athens-surface-subtle)]">
            <div
              className="h-full rounded-full bg-[var(--athens-brand)]"
              style={{
                width: `${Math.max(item.p, item.n > 0 ? 2 : 0)}%`,
                opacity: 1 - index * 0.14,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

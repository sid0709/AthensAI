import React from "react";
import { mono } from "../../lib/utils";

type FunnelItem = { s: string; n: number; p: number };

type FunnelBarsProps = {
  items: FunnelItem[];
  barHeight?: string;
  valueSize?: "sm" | "md";
};

export function FunnelBars({ items, barHeight = "h-2", valueSize = "sm" }: FunnelBarsProps) {
  return (
    <div className="space-y-4">
      {items.map((f, i) => (
        <div key={f.s}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-muted-foreground font-semibold">{f.s}</span>
            <div className="flex items-center gap-2">
              <span
                className={valueSize === "md" ? "text-base font-bold text-foreground" : "text-sm text-foreground font-bold"}
                style={mono}
              >
                {f.n}
              </span>
              <span className="text-xs text-muted-foreground" style={mono}>
                {f.p}%
              </span>
            </div>
          </div>
          <div className={`${barHeight} bg-secondary rounded-full overflow-hidden`}>
            <div
              className="h-full rounded-full transition-all duration-700 bg-primary"
              style={{ width: `${f.p}%`, opacity: 1 - i * (valueSize === "md" ? 0.1 : 0.12) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

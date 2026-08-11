import React from "react";

type TipPayload = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

export type ChartTipProps = {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  /** Cap height and scroll when many series are present. */
  scrollable?: boolean;
  /** Drop entries whose numeric value is 0 / empty. */
  hideZero?: boolean;
  /** Sort by numeric value descending. */
  sortByValue?: boolean;
  /** Optional total line under the label (e.g. day total). */
  total?: number | null;
  maxHeight?: number;
};

export function ChartTip({
  active,
  payload,
  label,
  scrollable = false,
  hideZero = false,
  sortByValue = false,
  total = null,
  maxHeight = 260,
}: ChartTipProps) {
  if (!active || !payload?.length) return null;

  let rows = payload.filter((p) => p != null);
  if (hideZero) {
    rows = rows.filter((p) => {
      const n = Number(p.value);
      return Number.isFinite(n) ? n > 0 : Boolean(p.value);
    });
  }
  if (sortByValue) {
    rows = [...rows].sort(
      (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0),
    );
  }
  if (rows.length === 0) return null;

  const enhanced = scrollable || hideZero || sortByValue || total != null;
  const showTotal = total != null && Number.isFinite(total);

  if (!enhanced) {
    return (
      <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
        <p className="text-muted-foreground font-semibold mb-1">{label}</p>
        {rows.map((p) => (
          <p key={String(p.dataKey ?? p.name)} className="font-semibold" style={{ color: p.color }}>
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div
      className="bg-white border border-[#dedede] rounded-xl px-3.5 py-3 text-sm shadow-[0_12px_32px_rgb(13_13_13_/8%)]"
      style={
        scrollable
          ? { maxHeight, overflowY: "auto", pointerEvents: "auto" }
          : undefined
      }
    >
      <p className="text-[#8e8e8e] text-xs font-semibold mb-1.5">{label}</p>
      {showTotal && (
        <p className="text-[#0d0d0d] text-xs font-semibold mb-2">
          Total: {total}
        </p>
      )}
      <div className="space-y-1.5">
        {rows.map((p) => (
          <div
            key={String(p.dataKey ?? p.name)}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: p.color || "#8e8e8e" }}
              aria-hidden
            />
            <span className="text-[#5d5d5d] flex-1 min-w-0 truncate">
              {p.name}
            </span>
            <span className="text-[#0d0d0d] font-semibold tabular-nums">
              {p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

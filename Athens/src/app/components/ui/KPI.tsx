import React from "react";
import { TrendingUp } from "lucide-react";
import { cn, display } from "../../lib/utils";

export function KPI({
  label,
  value,
  sub,
  trend,
  icon: Icon,
  accent = "violet",
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  const ic: Record<string, string> = {
    violet: "bg-violet-100 text-violet-600",
    emerald: "bg-emerald-100 text-emerald-600",
    blue: "bg-blue-100 text-blue-600",
    amber: "bg-amber-100 text-amber-600",
    pink: "bg-pink-100 text-pink-600",
    teal: "bg-teal-100 text-teal-600",
    rose: "bg-rose-100 text-rose-600",
    sky: "bg-sky-100 text-sky-600",
  };
  return (
    <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all duration-200 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            ic[accent] ?? ic.violet
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div
        className="text-2xl font-bold text-foreground leading-none mb-2"
        style={display}
      >
        {value}
      </div>
      <div className="flex items-center gap-2">
        {trend && (
          <span className="text-xs text-emerald-600 flex items-center gap-1 font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />
            {trend}
          </span>
        )}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

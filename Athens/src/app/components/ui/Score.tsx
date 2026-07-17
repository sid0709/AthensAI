import React from "react";
import { Star } from "lucide-react";
import { cn, mono } from "../../lib/utils";

export function Score({ score }: { score: number }) {
  const c =
    score >= 90
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : score >= 80
        ? "text-blue-700 bg-blue-50 border-blue-200"
        : "text-amber-700 bg-amber-50 border-amber-200";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold border",
        c
      )}
      style={mono}
    >
      <Star className="w-3.5 h-3.5" />
      {score}
    </span>
  );
}

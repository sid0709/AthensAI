import React from "react";
import { avColor, cn, initials } from "../../lib/utils";

export function Av({
  name,
  size = "md",
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const s =
    size === "xs"
      ? "w-6 h-6 text-xs"
      : size === "sm"
        ? "w-9 h-9 text-xs"
        : size === "lg"
          ? "w-12 h-12 text-base"
          : "w-10 h-10 text-sm";
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 select-none",
        avColor(name),
        s
      )}
    >
      {initials(name)}
    </div>
  );
}

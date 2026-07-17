import { cn } from "../../lib/utils";

export const athensFieldBase = cn(
  "bg-secondary border border-border rounded-xl text-sm text-foreground",
  "outline-none transition-colors min-h-10",
  "focus:border-primary/40 focus-visible:ring-0",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "placeholder:text-muted-foreground",
);

export const athensInputClass = cn(athensFieldBase, "px-4 py-2.5 w-full");

export const athensTextareaClass = cn(
  athensFieldBase,
  "px-4 py-3 w-full min-h-[88px] resize-y",
);

export const athensSelectTriggerClass = cn(
  athensFieldBase,
  "px-4 py-2.5 w-full flex items-center justify-between gap-2",
  "data-[placeholder]:text-muted-foreground",
);

export const athensLabelClass = "text-xs font-bold text-muted-foreground uppercase tracking-wide";

export const athensHintClass = "text-xs text-muted-foreground";

export const athensErrorClass = "text-xs text-destructive font-medium";

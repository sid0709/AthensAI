import type { TemplateLayout } from "../../../../types/resume";
import { cn } from "../../../../lib/utils";

const LAYOUT_STYLES: Record<TemplateLayout, string> = {
  standard: "flex flex-col gap-1",
  "two-column": "grid grid-cols-[1fr_2fr] gap-2",
  classic: "flex flex-col gap-1 items-start",
  centered: "flex flex-col gap-1 items-center",
  minimal: "flex flex-col gap-0.5",
  compact: "flex flex-col gap-0.5",
  modern: "flex flex-col gap-1 border-l-2 border-primary pl-1",
  bold: "flex flex-col gap-1.5",
};

export function TemplatePreviewThumb({ layout, selected }: { layout: TemplateLayout; selected?: boolean }) {
  return (
    <div
      className={cn(
        "w-full aspect-[8.5/11] bg-white rounded-lg border p-2 overflow-hidden",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border"
      )}
    >
      <div className={cn(LAYOUT_STYLES[layout], "h-full")}>
        <div className="h-2 w-3/4 bg-primary/60 rounded-sm mx-auto" />
        <div className="h-1 w-full bg-muted rounded-sm" />
        <div className="h-1 w-5/6 bg-muted/70 rounded-sm" />
        {layout === "two-column" ? (
          <>
            <div className="col-span-2 h-1 w-1/3 bg-primary/40 rounded-sm" />
            <div className="space-y-0.5">
              <div className="h-1 w-full bg-muted/60 rounded-sm" />
              <div className="h-1 w-4/5 bg-muted/50 rounded-sm" />
            </div>
            <div className="space-y-0.5">
              <div className="h-1 w-full bg-muted/60 rounded-sm" />
              <div className="h-1 w-full bg-muted/50 rounded-sm" />
              <div className="h-1 w-3/4 bg-muted/40 rounded-sm" />
            </div>
          </>
        ) : (
          <>
            <div className="h-1 w-1/4 bg-primary/40 rounded-sm" />
            <div className="h-1 w-full bg-muted/60 rounded-sm" />
            <div className="h-1 w-full bg-muted/50 rounded-sm" />
            <div className="h-1 w-2/3 bg-muted/40 rounded-sm" />
          </>
        )}
      </div>
    </div>
  );
}

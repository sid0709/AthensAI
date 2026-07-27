import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";
import { Loader2 } from "lucide-react";

type JobListSkeletonProps = {
  count?: number;
  layout?: "list" | "grid";
  className?: string;
};

function JobCardSkeleton() {
  return (
    <div className="bg-card border-2 border-transparent ring-1 ring-border rounded-xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-2/3 max-w-[280px]" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Skeleton className="h-10 w-14 rounded-lg" />
          <Skeleton className="h-10 w-14 rounded-lg" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
    </div>
  );
}

export function JobListSkeleton({
  count = 6,
  layout = "list",
  className,
}: JobListSkeletonProps) {
  const n = Math.min(Math.max(count, 3), 12);
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("py-2", className)}>
      <div className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-sm font-medium text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        Loading jobs…
      </div>
      <div
        className={cn(
          layout === "grid"
            ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            : "flex flex-col gap-4",
        )}
      >
        {Array.from({ length: n }, (_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

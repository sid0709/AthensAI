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
    <div className="athens-card">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-4 w-2/3 max-w-[280px]" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <Skeleton className="h-6 w-20 rounded-full shrink-0" />
      </div>
      <div className="athens-card-chips">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="athens-card-footer">
        <Skeleton className="h-3 w-24" />
        <div className="athens-card-actions">
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="h-9 w-16 rounded-lg" />
        </div>
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
    <div role="status" aria-busy="true" aria-live="polite" className={cn("athens-ui py-2", className)}>
      <div className="mb-3 flex items-center justify-center gap-2 athens-surface px-3 py-2 text-sm text-[var(--athens-text-secondary)]">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading jobs…
      </div>
      <div
        className={cn(
          layout === "grid" ? "athens-card-grid" : "flex flex-col gap-4",
        )}
      >
        {Array.from({ length: n }, (_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

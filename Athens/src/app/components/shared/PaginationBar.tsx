import React from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../ui/pagination";
import { cn } from "../../lib/utils";
import { AthensSelect } from "../forms";
import { Loader2 } from "lucide-react";

type PaginationBarProps = {
  page: number;
  pageSize: number;
  total: number | null;
  itemCount?: number;
  hasMore?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
  align?: "left" | "center" | "between";
  detailed?: boolean;
  loading?: boolean;
  unitLabel?: string;
  secondaryTotal?: number | null;
  secondaryLabel?: string;
};

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export function PaginationBar({
  page,
  pageSize,
  total,
  itemCount,
  hasMore = false,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  className,
  align = "between",
  detailed = false,
  loading = false,
  unitLabel = "results",
  secondaryTotal,
  secondaryLabel = "matching jobs",
}: PaginationBarProps) {
  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const showingCount =
    itemCount ?? (total === null || total === 0 ? 0 : Math.min(pageSize, total - (page - 1) * pageSize));
  const start = showingCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = showingCount === 0 ? 0 : start + showingCount - 1;
  const pages = loading || totalPages === null ? [] : pageNumbers(page, totalPages);
  const canGoNext = !loading && (totalPages === null ? hasMore : page < totalPages);

  return (
    <div
      aria-busy={loading}
      className={cn(
        "flex items-center gap-4 py-3 px-1 flex-wrap",
        align === "between" && "justify-between",
        align === "center" && "justify-center",
        align === "left" && "justify-start",
        className,
      )}
    >
      <div className="flex items-center gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground whitespace-nowrap">
          {loading ? (
            <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading results…
            </span>
          ) : total === null
            ? `${showingCount} loaded · Page ${page}`
            : total === 0 && showingCount === 0
              ? "No results"
            : detailed
              ? `Showing ${showingCount} of ${Math.max(total, showingCount).toLocaleString()} ${unitLabel}${secondaryTotal == null ? "" : ` · ${Math.max(secondaryTotal ?? 0, showingCount).toLocaleString()} ${secondaryLabel}`} · Page ${page} / ${Math.max(1, Math.ceil(Math.max(total, showingCount) / pageSize))}`
              : `${start}–${end} of ${Math.max(total, showingCount)}`}
        </p>
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Per page</span>
            <AthensSelect
              value={String(pageSize)}
              onChange={(v) => onPageSizeChange(Number(v))}
              options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
              size="sm"
              className="w-20"
              disabled={loading}
            />
          </div>
        )}
      </div>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (!loading && page > 1) onPageChange(page - 1);
              }}
              aria-disabled={loading || page <= 1}
              className={loading || page <= 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === "ellipsis" ? (
              <PaginationItem key={`e-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === page}
                  onClick={(e) => {
                    e.preventDefault();
                    if (!loading) onPageChange(p);
                  }}
                  aria-disabled={loading}
                  className={cn("min-w-9", loading ? "pointer-events-none opacity-40" : "cursor-pointer")}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (!loading && canGoNext) onPageChange(page + 1);
              }}
              aria-disabled={loading || !canGoNext}
              className={loading || !canGoNext ? "pointer-events-none opacity-40" : "cursor-pointer"}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

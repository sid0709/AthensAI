import React, { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Av } from "../../../components/ui";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { CompanyJobGroup, Job } from "../../../types";
import type { JobResumeGenerationState } from "../hooks/useJobResumeGeneration";
import { JobCard } from "./JobCard";

type CompanyJobCarouselProps = {
  group: CompanyJobGroup;
  activeJobId?: string;
  onActiveJobChange?: (jobId: string) => void;
  selectedIds?: Set<string>;
  onSelectJob?: (id: string, shiftKey: boolean) => void;
  showScores?: boolean;
  bookmarkedIds?: Set<string>;
  onToggleBookmark?: (id: string) => void;
  isJobPending?: (jobId: string) => boolean;
  onApply?: (job: Job) => void;
  onMarkBidReady?: (job: Job) => void;
  onMarkScheduled?: (job: Job) => void;
  onMarkDeclined?: (job: Job) => void;
  onCancel?: (job: Job) => void;
  onJobScoresUpdated?: (job: Job) => void;
  resumeStates?: Record<string, JobResumeGenerationState>;
  onGenerateResume?: (job: Job) => void;
  onLoadMore?: (companyId: string) => void;
  loadingMore?: boolean;
};

function visibleDotIndexes(selected: number, count: number): number[] {
  const visible = Math.min(7, count);
  const maxStart = Math.max(0, count - visible);
  const start = Math.min(maxStart, Math.max(0, selected - Math.floor(visible / 2)));
  return Array.from({ length: visible }, (_, index) => start + index);
}

export function CompanyJobCarousel({
  group,
  activeJobId,
  onActiveJobChange,
  selectedIds,
  onSelectJob,
  showScores = true,
  bookmarkedIds,
  onToggleBookmark,
  isJobPending,
  onApply,
  onMarkBidReady,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  onJobScoresUpdated,
  resumeStates,
  onGenerateResume,
  onLoadMore,
  loadingMore = false,
}: CompanyJobCarouselProps) {
  const initialIndex = Math.max(0, group.jobs.findIndex((job) => job.id === activeJobId));
  const [viewportRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    startIndex: initialIndex,
    watchDrag: true,
  });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(group.jobs.length > 1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const syncSelection = useCallback(() => {
    if (!emblaApi) return;
    const index = emblaApi.selectedScrollSnap();
    setSelectedIndex(index);
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
    const job = group.jobs[index];
    if (job) onActiveJobChange?.(job.id);
  }, [emblaApi, group.jobs, onActiveJobChange]);

  useEffect(() => {
    if (!emblaApi) return;
    syncSelection();
    emblaApi.on("select", syncSelection).on("reInit", syncSelection);
    return () => {
      emblaApi.off("select", syncSelection).off("reInit", syncSelection);
    };
  }, [emblaApi, syncSelection]);

  useEffect(() => {
    if (!emblaApi || !activeJobId) return;
    const index = group.jobs.findIndex((job) => job.id === activeJobId);
    if (index >= 0 && index !== emblaApi.selectedScrollSnap()) emblaApi.scrollTo(index, true);
  }, [activeJobId, emblaApi, group.jobs]);

  useEffect(() => {
    if (
      selectedIndex >= group.jobs.length - 1 &&
      group.nextMemberOffset != null &&
      !loadingMore
    ) {
      onLoadMore?.(group.companyId);
    }
  }, [group.companyId, group.jobs.length, group.nextMemberOffset, loadingMore, onLoadMore, selectedIndex]);

  const dots = useMemo(
    () => visibleDotIndexes(selectedIndex, group.jobs.length),
    [group.jobs.length, selectedIndex],
  );
  const total = group.matchingJobCount ?? group.jobs.length;

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      aria-label={`${group.company.name} roles`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          emblaApi?.scrollPrev(reduceMotion);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          emblaApi?.scrollNext(reduceMotion);
        }
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-secondary/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarImage src={group.company.logoUrl} alt={`${group.company.name} logo`} />
            <AvatarFallback className="p-0">
              <Av name={group.company.name} size="sm" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-foreground">{group.company.name}</h2>
            <p className="text-xs text-muted-foreground">{total.toLocaleString()} roles</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {Math.min(selectedIndex + 1, total)} / {total}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => emblaApi?.scrollPrev(reduceMotion)}
            disabled={!canScrollPrev}
            aria-label={`Previous ${group.company.name} role`}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => emblaApi?.scrollNext(reduceMotion)}
            disabled={!canScrollNext}
            aria-label={`Next ${group.company.name} role`}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      <div className="overflow-hidden" ref={viewportRef}>
        <div className="flex touch-pan-y">
          {group.jobs.map((job) => (
            <div key={job.id} className="min-w-0 flex-[0_0_100%] p-1">
              <JobCard
                job={job}
                className="rounded-lg border-transparent shadow-none ring-0"
                selected={selectedIds?.has(job.id)}
                onSelect={onSelectJob ? (shiftKey) => onSelectJob(job.id, shiftKey) : undefined}
                showScores={showScores}
                bookmarked={bookmarkedIds?.has(job.id)}
                onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(job.id) : undefined}
                statusPending={isJobPending?.(job.id)}
                onApply={onApply ? () => onApply(job) : undefined}
                onMarkBidReady={onMarkBidReady ? () => onMarkBidReady(job) : undefined}
                onMarkScheduled={onMarkScheduled ? () => onMarkScheduled(job) : undefined}
                onMarkDeclined={onMarkDeclined ? () => onMarkDeclined(job) : undefined}
                onCancel={onCancel ? () => onCancel(job) : undefined}
                onJobScoresUpdated={onJobScoresUpdated}
                resumeState={resumeStates?.[job.id]}
                onGenerateResume={onGenerateResume ? () => onGenerateResume(job) : undefined}
              />
            </div>
          ))}
          {loadingMore ? (
            <div className="min-w-0 flex-[0_0_100%] p-5" aria-hidden>
              <div className="flex min-h-64 animate-pulse flex-col gap-5 rounded-lg bg-secondary/30 p-5 motion-reduce:animate-none">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/5 rounded bg-muted" />
                    <div className="h-3 w-1/4 rounded bg-muted" />
                  </div>
                </div>
                <div className="h-7 w-3/5 rounded bg-muted" />
                <div className="flex gap-2">
                  <div className="h-6 w-20 rounded-full bg-muted" />
                  <div className="h-6 w-24 rounded-full bg-muted" />
                  <div className="h-6 w-16 rounded-full bg-muted" />
                </div>
                <div className="mt-auto h-10 rounded bg-muted" />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex min-h-8 items-center justify-center gap-1.5 border-t border-border/60 px-4 py-2">
        {dots.map((index) => (
          <button
            key={index}
            type="button"
            className={cn(
              "size-2 rounded-full transition-[width,background-color] motion-reduce:transition-none",
              index === selectedIndex ? "w-5 bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
            )}
            onClick={() => emblaApi?.scrollTo(index, reduceMotion)}
            aria-label={`Show role ${index + 1} of ${total}`}
            aria-current={index === selectedIndex ? "true" : undefined}
          />
        ))}
        {loadingMore ? (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <span className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary motion-reduce:animate-none" />
            Loading roles…
          </span>
        ) : null}
      </footer>
    </section>
  );
}

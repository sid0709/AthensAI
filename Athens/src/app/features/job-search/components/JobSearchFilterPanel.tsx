import React, { useState } from "react";
import {
  Building2,
  ChevronDown,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { Button } from "../../../components/ui/button";
import { AthensSelect } from "../../../components/forms";
import { isBetaTier } from "../../../lib/beta";
import { cn } from "../../../lib/utils";
import {
  countAttributeFilters,
  countScoreFilters,
  getActiveFilterChips,
  type JobSearchFilterState,
  type JobStatusTab,
} from "../../../hooks/useJobSearchFilters";
import { ActiveFilterChips } from "./filters/ActiveFilterChips";
import { JobFiltersSheet } from "./filters/JobFiltersSheet";
import { JobScoreFiltersPopover } from "./filters/JobScoreFiltersPopover";
import { JobTitleRoleFilterPopover } from "./filters/JobTitleRoleFilterPopover";
import { MySkillsPopover } from "./MySkillsPopover";
import { SkillExtractionButton } from "./SkillExtractionButton";
import { TitleScanButton } from "./TitleScanButton";

const STATUS_TABS: {
  id: JobStatusTab;
  label: string;
  dot: string;
}[] = [
  { id: "all", label: "All", dot: "bg-foreground" },
  { id: "posted", label: "New", dot: "bg-emerald-500" },
  { id: "bid-ready", label: "Bid ready", dot: "bg-sky-500" },
  { id: "bid-completed", label: "Bid completed", dot: "bg-violet-500" },
  { id: "applied", label: "Applied", dot: "bg-blue-500" },
  { id: "scheduled", label: "Scheduled", dot: "bg-amber-500" },
  { id: "declined", label: "Declined", dot: "bg-rose-500" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "matchScore", label: "Best match" },
  { value: "title", label: "Title A–Z" },
];

type JobSearchFilterPanelProps = {
  filters: JobSearchFilterState;
  onChange: (filters: JobSearchFilterState) => void;
  statusCounts: Record<JobStatusTab, number>;
  showScoresOnCards: boolean;
  onShowScoresOnCardsChange: (v: boolean) => void;
  matchScoreHint?: string | null;
  matchScoreHintVariant?: "info" | "warning";
  /** Hide All/New/Applied status tabs (e.g. task pool always uses New/posted). */
  showStatusTabs?: boolean;
  /** Hide My Skills / Skill Extraction tools used only on Job Search. */
  showSkillsTools?: boolean;
};

function ToolbarDivider() {
  return <div className="hidden sm:block w-px h-6 bg-border/80 shrink-0" aria-hidden />;
}

function CompactInput({
  icon: Icon,
  value,
  onChange,
  placeholder,
  className,
  nested = false,
}: {
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  nested?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 h-9 min-w-0 transition-all",
        nested
          ? "bg-transparent border-0 rounded-md px-2 focus-within:bg-background/60"
          : "bg-secondary/60 border border-border rounded-lg px-2.5 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/10",
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none flex-1 min-w-0"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-muted-foreground hover:text-foreground">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function JobSearchFilterPanel({
  filters,
  onChange,
  statusCounts,
  showScoresOnCards,
  onShowScoresOnCardsChange,
  matchScoreHint,
  matchScoreHintVariant = "info",
  showStatusTabs = true,
  showSkillsTools = true,
}: JobSearchFilterPanelProps) {
  const { applier } = useApplier();
  const isBeta = isBetaTier(applier?.tier);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);

  const patch = (partial: Partial<JobSearchFilterState>) => onChange({ ...filters, ...partial });
  const attributeCount = countAttributeFilters(filters);
  const scoreCount = countScoreFilters(filters);
  const chips = getActiveFilterChips(
    isBeta ? filters : { ...filters, titleRoles: [] },
  );
  const hasChips = chips.length > 0;

  return (
    <div className="-mx-1 px-1 mb-2 overflow-y-visible">
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-sm overflow-x-clip">
        {/* Layer 1: status tabs */}
        {showStatusTabs ? (
          <div className="flex items-end gap-0.5 px-3 pt-1 scroll-x-only border-b border-border/60">
            {STATUS_TABS.map((tab) => {
              const active = filters.statusTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => patch({ statusTab: tab.id })}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors shrink-0 border-b-2",
                    active
                      ? "text-foreground border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:border-border",
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", tab.dot)} />
                  {tab.label}
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[11px] tabular-nums font-medium",
                      active ? "bg-muted text-foreground" : "bg-muted/60 text-muted-foreground",
                    )}
                  >
                    {statusCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Layer 2: primary controls */}
        <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap overflow-y-hidden">
          <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-muted/50 rounded-lg p-1 border border-border/40">
            <CompactInput
              icon={Search}
              value={filters.jobQuery}
              onChange={(jobQuery) => patch({ jobQuery })}
              placeholder="Search roles…"
              nested
              className="flex-1 min-w-[120px] sm:max-w-[200px]"
            />
            <div className="w-px h-5 bg-border/60 shrink-0 hidden sm:block" aria-hidden />
            <CompactInput
              icon={Building2}
              value={filters.companyQuery}
              onChange={(companyQuery) => patch({ companyQuery })}
              placeholder="Company…"
              nested
              className="w-[96px] sm:w-[112px] shrink-0"
            />
          </div>

          <ToolbarDivider />

          <div className="flex items-center gap-2 shrink-0">
            <AthensSelect
              value={filters.sort}
              onChange={(sort) => patch({ sort: sort as JobSearchFilterState["sort"] })}
              options={SORT_OPTIONS}
              size="sm"
              className="w-[140px] shrink-0"
            />

            {isBeta ? (
              <JobTitleRoleFilterPopover filters={filters} onChange={onChange} />
            ) : null}
          </div>

          <ToolbarDivider />

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 shrink-0"
              onClick={() => setSheetOpen(true)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {attributeCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {attributeCount}
                </span>
              )}
            </Button>

            <JobScoreFiltersPopover
              filters={filters}
              onChange={onChange}
              scoreCount={scoreCount}
              showOnCards={showScoresOnCards}
              onShowOnCardsChange={onShowScoresOnCardsChange}
            />
          </div>

          {showSkillsTools ? (
            <>
              <ToolbarDivider />
              <div className="flex items-center gap-1.5 sm:ml-auto shrink-0">
                <MySkillsPopover />
                <TitleScanButton />
                <SkillExtractionButton />
              </div>
            </>
          ) : null}
        </div>

        {/* Layer 3: active filter chips (collapsible) */}
        {hasChips && (
          <div className="border-t border-border/60">
            <button
              type="button"
              onClick={() => setChipsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            >
              <span>
                {chips.length} active filter{chips.length !== 1 ? "s" : ""}
              </span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", chipsOpen && "rotate-180")} />
            </button>
            {chipsOpen && (
              <ActiveFilterChips filters={filters} chips={chips} onChange={onChange} />
            )}
          </div>
        )}

        {/* Match-score hint banner */}
        {matchScoreHint ? (
          <div
            className={cn(
              "border-t px-3 py-2 text-xs flex items-center gap-2",
              matchScoreHintVariant === "warning"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                : "border-border/60 text-muted-foreground",
            )}
          >
            <Sparkles
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                matchScoreHintVariant === "warning" ? "text-amber-600 dark:text-amber-400" : "text-primary/70",
              )}
            />
            <span>{matchScoreHint}</span>
          </div>
        ) : null}
      </div>

        <JobFiltersSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          filters={filters}
          onChange={onChange}
          showTitleRoleFilter={isBeta}
        />
    </div>
  );
}

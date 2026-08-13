import React, { useState } from "react";
import {
  Building2,
  ChevronDown,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  countAttributeFilters,
  getActiveFilterChips,
  type JobSearchFilterState,
  type JobStatusTab,
} from "../../../hooks/useJobSearchFilters";
import { ActiveFilterChips } from "./filters/ActiveFilterChips";
import { JobFiltersSheet } from "./filters/JobFiltersSheet";
import { SkillExtractionButton } from "./SkillExtractionButton";

const STATUS_TABS: {
  id: JobStatusTab;
  label: string;
  dot: string;
}[] = [
  { id: "all", label: "All", dot: "bg-foreground" },
  { id: "posted", label: "New", dot: "bg-emerald-500" },
  { id: "bid-ready", label: "Bid ready", dot: "bg-sky-500" },
  { id: "worker-pool", label: "Worker pool", dot: "bg-teal-500" },
  { id: "bid-completed", label: "Bid completed", dot: "bg-violet-500" },
  { id: "applied", label: "Applied", dot: "bg-blue-500" },
  { id: "scheduled", label: "Scheduled", dot: "bg-amber-500" },
  { id: "declined", label: "Declined", dot: "bg-rose-500" },
];

type JobSearchFilterPanelProps = {
  filters: JobSearchFilterState;
  onChange: (filters: JobSearchFilterState) => void;
  statusCounts: Record<JobStatusTab, number>;
  countsLoading?: boolean;
  /** Hide All/New/Applied status tabs (e.g. task pool always uses New/posted). */
  showStatusTabs?: boolean;
  /** Worker pool tab is beta-only. */
  showWorkerPoolTab?: boolean;
  /** Hide My Skills / Skill Extraction tools used only on Job Search. */
  showSkillsTools?: boolean;
};

function CompactInput({
  icon: Icon,
  value,
  onChange,
  placeholder,
  className,
}: {
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("athens-field", className)}>
      <Icon className="athens-field__icon" aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="athens-field__input"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="athens-field__clear"
          aria-label={`Clear ${placeholder}`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function JobSearchFilterPanel({
  filters,
  onChange,
  statusCounts,
  countsLoading = false,
  showStatusTabs = true,
  showWorkerPoolTab = false,
  showSkillsTools = true,
}: JobSearchFilterPanelProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);
  const statusTabs = showWorkerPoolTab
    ? STATUS_TABS
    : STATUS_TABS.filter((tab) => tab.id !== "worker-pool");

  const patch = (partial: Partial<JobSearchFilterState>) => onChange({ ...filters, ...partial });
  const attributeCount = countAttributeFilters(filters);
  const chips = getActiveFilterChips(filters);
  const hasChips = chips.length > 0;

  return (
    <div className="athens-toolbar mb-2">
      <div className="athens-surface">
        {showStatusTabs ? (
          <div className="athens-tabs scroll-x-only" role="tablist" aria-label="Job status">
            {statusTabs.map((tab) => {
              const active = filters.statusTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-current={active ? "true" : undefined}
                  onClick={() => patch({ statusTab: tab.id })}
                  className={cn("athens-tab", active && "is-active")}
                >
                  <span className={cn("athens-tab-dot", tab.dot)} />
                  {tab.label}
                  <span className="athens-count">
                    {countsLoading ? (
                      <span className="inline-block h-2.5 w-5 animate-pulse rounded bg-current/20" aria-label="Updating count" />
                    ) : statusCounts[tab.id].toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="athens-toolbar-row">
          <div className="athens-field-group">
            <CompactInput
              icon={Search}
              value={filters.jobQuery}
              onChange={(jobQuery) => patch({ jobQuery })}
              placeholder="Search roles…"
            />
            <div className="athens-field-divider" aria-hidden />
            <CompactInput
              icon={Building2}
              value={filters.companyQuery}
              onChange={(companyQuery) => patch({ companyQuery })}
              placeholder="Company…"
              className="athens-field--company"
            />
          </div>

          <div className="athens-toolbar-actions">
            <button
              type="button"
              className="athens-btn"
              onClick={() => setSheetOpen(true)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filters
              {attributeCount > 0 ? (
                <span className="athens-badge">{attributeCount}</span>
              ) : null}
            </button>
            {showSkillsTools ? <SkillExtractionButton /> : null}
          </div>
        </div>

        {hasChips ? (
          <div>
            <button
              type="button"
              onClick={() => setChipsOpen((v) => !v)}
              className="athens-chips-toggle"
            >
              <span>
                {chips.length} active filter{chips.length !== 1 ? "s" : ""}
              </span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cn("transition-transform", chipsOpen && "rotate-180")}
              />
            </button>
            {chipsOpen ? (
              <ActiveFilterChips filters={filters} chips={chips} onChange={onChange} />
            ) : null}
          </div>
        ) : null}
      </div>

      <JobFiltersSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        onChange={onChange}
      />
    </div>
  );
}

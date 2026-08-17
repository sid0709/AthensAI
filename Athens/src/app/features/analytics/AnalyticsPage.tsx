import React, { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { PageShell } from "../../components/layout/PageShell";
import { TabTransition } from "../../components/overlays";
import { DEFAULT_TABS, normalizeTab, PATHS, type ReportsTab } from "../../config/routes";
import { AnalyticsFilterPanel } from "./components/AnalyticsFilterPanel";
import { AnalyticsLoading, AnalyticsProfileGate } from "./components/AnalyticsStates";
import { ApplicationProgress } from "./components/ApplicationProgress";
import { JobPostingProgress } from "./components/JobPostingProgress";
import { useAnalyticsUrlState } from "./hooks/useAnalyticsUrlState";
import { useJobAnalytics } from "./hooks/useJobAnalytics";
import { resolveAnalyticsBounds } from "./lib/dateRange";
import { rangeLabel } from "./lib/rangeFilter";

const TABS = ["postings", "applications"] as const satisfies readonly ReportsTab[];

export function AnalyticsPage() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = normalizeTab(tabParam, TABS, DEFAULT_TABS.reports);
  const { filters, setFilters } = useAnalyticsUrlState();
  const analytics = useJobAnalytics(filters);
  const bounds = useMemo(() => resolveAnalyticsBounds(filters), [filters]);
  const caption = `${tab === "postings" ? "Job posting progress" : "Your application progress"} for ${rangeLabel(filters.range, {
    from: bounds.startDay,
    to: bounds.endDay,
  })}`;

  const body = analytics.loading ? (
    <AnalyticsLoading />
  ) : (
    <AnalyticsProfileGate ready={analytics.ready}>
      {tab === "postings" && (
        <JobPostingProgress caption={caption} analytics={analytics} bounds={bounds} />
      )}
      {tab === "applications" && (
        <ApplicationProgress caption={caption} analytics={analytics} bounds={bounds} />
      )}
    </AnalyticsProfileGate>
  );

  return (
    <PageShell className="athens-ui">
      <AnalyticsFilterPanel
        tab={tab}
        onTabChange={(next) =>
          navigate({ pathname: `${PATHS.reports}/${next}`, search: location.search })
        }
        filters={filters}
        onChange={setFilters}
      />
      <TabTransition tabKey={tab}>{body}</TabTransition>
    </PageShell>
  );
}

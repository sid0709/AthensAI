import React from "react";
import { useNavigate, useParams } from "react-router";
import { PageShell } from "../../components/layout/PageShell";
import { Pill } from "../../components/ui";
import { TabTransition } from "../../components/overlays";
import { AthensSelect } from "../../components/forms";
import { DEFAULT_TABS, normalizeTab, PATHS, type ReportsTab } from "../../config/routes";
import { useAnalyticsFilters, DATE_RANGE_OPTIONS } from "../../hooks/useAnalyticsFilters";
import { useJobAnalytics } from "./hooks/useJobAnalytics";
import { AnalyticsOverviewTab } from "./components/AnalyticsOverviewTab";
import { AnalyticsSourcesTab } from "./components/AnalyticsSourcesTab";
import { AnalyticsFunnelTab } from "./components/AnalyticsFunnelTab";
import { AnalyticsVelocityTab } from "./components/AnalyticsVelocityTab";
import { AnalyticsInsightsTab } from "./components/AnalyticsInsightsTab";
import { AnalyticsLoading, AnalyticsProfileGate } from "./components/AnalyticsStates";

const TABS = ["overview", "sources", "funnel", "velocity", "insights"] as const satisfies readonly ReportsTab[];

export function AnalyticsPage() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const tab = normalizeTab(tabParam, TABS, DEFAULT_TABS.reports);
  const { range, setRange } = useAnalyticsFilters();
  const analytics = useJobAnalytics(range);

  const body = analytics.loading ? (
    <AnalyticsLoading />
  ) : (
    <AnalyticsProfileGate ready={analytics.ready}>
      {tab === "overview" && <AnalyticsOverviewTab range={range} analytics={analytics} />}
      {tab === "sources" && <AnalyticsSourcesTab range={range} analytics={analytics} />}
      {tab === "funnel" && <AnalyticsFunnelTab range={range} analytics={analytics} />}
      {tab === "velocity" && <AnalyticsVelocityTab range={range} analytics={analytics} />}
      {tab === "insights" && <AnalyticsInsightsTab range={range} analytics={analytics} />}
    </AnalyticsProfileGate>
  );

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-1 bg-secondary rounded-xl p-1 scroll-row">
          {TABS.map((t) => (
            <Pill
              key={t}
              active={tab === t}
              onClick={() => navigate(`${PATHS.reports}/${t}`)}
            >
              {t}
            </Pill>
          ))}
        </div>
        <AthensSelect
          value={range}
          onChange={(v) => setRange(v as typeof range)}
          options={DATE_RANGE_OPTIONS}
          className="w-44"
        />
      </div>
      <TabTransition tabKey={tab}>{body}</TabTransition>
    </PageShell>
  );
}

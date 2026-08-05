import React from "react";
import { useNavigate, useParams } from "react-router";
import { PageShell } from "../../components/layout/PageShell";
import { Pill } from "../../components/ui";
import { TabTransition } from "../../components/overlays";
import { DEFAULT_TABS, normalizeTab, PATHS, type SettingsTab } from "../../config/routes";
import { ProfileTab } from "./components/ProfileTab";
import { NotificationsTab } from "./components/NotificationsTab";
import { SecurityTab } from "./components/SecurityTab";
import { IntegrationsTab } from "./components/IntegrationsTab";
import { useApplier } from "@/context/applier-context";
import { isBetaTier } from "../../lib/beta";

const ALL_TABS = ["profile", "notifications", "integrations", "security"] as const satisfies readonly SettingsTab[];

export function SettingsPage() {
  const { applier } = useApplier();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const tabs = ALL_TABS.filter((tab) => tab !== "integrations" || isBetaTier(applier?.tier));
  const tab = normalizeTab(tabParam, tabs, DEFAULT_TABS.settings);

  return (
    <PageShell>
      <div className="flex items-center gap-1 bg-secondary rounded-xl p-1 w-fit mb-6 scroll-row">
        {tabs.map((t) => (
          <Pill
            key={t}
            active={tab === t}
            onClick={() => navigate(`${PATHS.settings}/${t}`)}
          >
            {t}
          </Pill>
        ))}
      </div>
      <TabTransition tabKey={tab}>
        {tab === "profile" && <ProfileTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "security" && <SecurityTab />}
      </TabTransition>
    </PageShell>
  );
}

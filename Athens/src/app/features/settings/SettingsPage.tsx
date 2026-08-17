import React from "react";
import { useNavigate, useParams } from "react-router";
import { Bell, Plug, Shield, UserRound } from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { TabTransition } from "../../components/overlays";
import { ThemeToggle } from "../../components/shared/ThemeToggle";
import { DEFAULT_TABS, normalizeTab, PATHS, type SettingsTab } from "../../config/routes";
import { ProfileTab } from "./components/ProfileTab";
import { NotificationsTab } from "./components/NotificationsTab";
import { SecurityTab } from "./components/SecurityTab";
import { IntegrationsTab } from "./components/IntegrationsTab";
import { useApplier } from "@/context/applier-context";
import { isBetaTier } from "../../lib/beta";
import { cn } from "../../lib/utils";

const ALL_TABS = ["profile", "notifications", "integrations", "security"] as const satisfies readonly SettingsTab[];

const TAB_META: Record<SettingsTab, { label: string; icon: typeof UserRound }> = {
  profile: { label: "Profile", icon: UserRound },
  notifications: { label: "Notifications", icon: Bell },
  integrations: { label: "Integrations", icon: Plug },
  security: { label: "Security", icon: Shield },
};

export function SettingsPage() {
  const { applier } = useApplier();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const tabs = ALL_TABS.filter((tab) => tab !== "integrations" || isBetaTier(applier?.tier));
  const tab = normalizeTab(tabParam, tabs, DEFAULT_TABS.settings);

  return (
    <PageShell className="athens-ui athens-settings">
      <div className="athens-toolbar mb-2">
        <div className="athens-surface">
          <div className="athens-settings__chrome">
            <div className="athens-tabs scroll-x-only" role="tablist" aria-label="Settings">
              {tabs.map((t) => {
                const active = tab === t;
                const { label, icon: Icon } = TAB_META[t];
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-current={active ? "true" : undefined}
                    onClick={() => navigate(`${PATHS.settings}/${t}`)}
                    className={cn("athens-tab", active && "is-active")}
                  >
                    <span className="athens-tab-icon">
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
            <ThemeToggle tone="lens" compact className="athens-settings__theme" />
          </div>
        </div>
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

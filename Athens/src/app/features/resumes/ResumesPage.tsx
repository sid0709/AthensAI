import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BarChart3, Clock, FileStack, Library, Wand2 } from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { TabTransition } from "../../components/overlays";
import { DEFAULT_TABS, normalizeTab, PATHS, type ResumesTab } from "../../config/routes";
import { useResumeNavigationOptional } from "../../context/ResumeNavigationContext";
import { initResumeStorage } from "../../services/resumeStorage";
import { ResumeLibraryTab } from "./components/ResumeLibraryTab";
import { ResumeAnalysisTab } from "./components/ResumeAnalysisTab";
import { ResumeGeneratorPanel } from "./generator/ResumeGeneratorPanel";
import type { FullRun } from "./generator/history/history-types";
import { cn } from "../../lib/utils";

const TABS = ["library", "editor", "history", "analysis"] as const satisfies readonly ResumesTab[];

const TAB_META: Record<ResumesTab, { label: string; icon: typeof Library }> = {
  library: { label: "Library", icon: Library },
  editor: { label: "Editor", icon: FileStack },
  history: { label: "History", icon: Clock },
  analysis: { label: "Analysis", icon: BarChart3 },
};

export function ResumesPage() {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const nav = useResumeNavigationOptional();
  const tab = normalizeTab(tabParam, TABS, DEFAULT_TABS.resumes);
  const setTab = useCallback(
    (next: ResumesTab) => navigate(`${PATHS.resumes}/${next}`),
    [navigate],
  );

  const [editorJd, setEditorJd] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [pendingRun, setPendingRun] = useState<FullRun | null>(null);

  useEffect(() => {
    initResumeStorage().then(() => setReady(true));
  }, []);

  useEffect(() => {
    const pending = nav?.pendingEditorOpen;
    if (!pending || !ready) return;
    const nextTab = pending.tab ?? "editor";
    if (pending.jd) setEditorJd(pending.jd);
    navigate(`${PATHS.resumes}/${nextTab}`);
    nav.clearPendingEditorOpen();
  }, [nav?.pendingEditorOpen, ready, nav, navigate]);

  const handleLoadFromHistory = useCallback(
    (run: FullRun) => {
      setPendingRun(run);
      const jd = typeof run.jobDescription === "string" ? run.jobDescription : (run.config?.jobDescription as string | undefined);
      if (jd) setEditorJd(jd);
      navigate(`${PATHS.resumes}/editor`);
    },
    [navigate],
  );

  const pageTabs = (
    <div className="athens-tabs scroll-x-only" role="tablist" aria-label="Resumes">
      {TABS.map((t) => {
        const active = tab === t;
        const { label, icon: Icon } = TAB_META[t];
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "true" : undefined}
            onClick={() => setTab(t)}
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
  );

  const generateNav = (primary = false) => (
    <button type="button" onClick={() => setTab("editor")} className={primary ? "athens-btn-primary" : "athens-btn"}>
      <Wand2 size={16} aria-hidden="true" />
      Generate
    </button>
  );

  if (!ready) {
    return (
      <PageShell className="athens-ui">
        <div className="athens-settings__loading">Loading resume data…</div>
      </PageShell>
    );
  }

  return (
    <PageShell className="athens-ui">
      <TabTransition tabKey={tab}>
        {tab === "library" && (
          <ResumeLibraryTab
            pageTabs={pageTabs}
            pageActions={generateNav()}
            onLoadIntoEditor={handleLoadFromHistory}
          />
        )}
        {tab === "history" && (
          <ResumeGeneratorPanel
            key={historyKey}
            pageTabs={pageTabs}
            pageActions={generateNav(true)}
            activeView="history"
            onLoadIntoEditor={handleLoadFromHistory}
            onGenerated={() => setHistoryKey((k) => k + 1)}
          />
        )}
        {tab === "editor" && (
          <ResumeGeneratorPanel
            pageTabs={pageTabs}
            activeView="editor"
            initialJd={editorJd}
            pendingRun={pendingRun}
            onPendingRunConsumed={() => setPendingRun(null)}
            onGenerated={() => setHistoryKey((k) => k + 1)}
          />
        )}
        {tab === "analysis" && (
          <>
            <div className="athens-toolbar mb-2">
              <div className="athens-surface">
                {pageTabs}
                <div className="athens-toolbar-row">
                  <div className="athens-toolbar-actions ml-auto">{generateNav(true)}</div>
                </div>
              </div>
            </div>
            <ResumeAnalysisTab onOpenLibrary={() => setTab("library")} />
          </>
        )}
      </TabTransition>
    </PageShell>
  );
}

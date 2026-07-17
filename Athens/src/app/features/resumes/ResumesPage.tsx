import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Wand2 } from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { Pill } from "../../components/ui";
import { TabTransition } from "../../components/overlays";
import { DEFAULT_TABS, normalizeTab, PATHS, type ResumesTab } from "../../config/routes";
import { useResumeNavigationOptional } from "../../context/ResumeNavigationContext";
import { initResumeStorage } from "../../services/resumeStorage";
import { ResumeLibraryTab } from "./components/ResumeLibraryTab";
import { ResumeAnalysisTab } from "./components/ResumeAnalysisTab";
import { ResumeGeneratorPanel } from "./generator/ResumeGeneratorPanel";
import type { FullRun } from "./generator/history/history-types";

const TABS = ["library", "editor", "history", "analysis"] as const satisfies readonly ResumesTab[];

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

  if (!ready) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading resume data…</div>
      </PageShell>
    );
  }

  const tabPills = (
    <div className="flex items-center gap-1 bg-secondary rounded-xl p-1 scroll-row">
      {TABS.map((t) => (
        <Pill key={t} active={tab === t} onClick={() => setTab(t)}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </Pill>
      ))}
    </div>
  );

  return (
    <PageShell>
      <div className="page-container">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          {tabPills}
          {tab !== "editor" && (
            <button
              type="button"
              onClick={() => setTab("editor")}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10"
            >
              <Wand2 className="w-4 h-4" />Generate
            </button>
          )}
        </div>

        <TabTransition tabKey={tab}>
          {tab === "library" && (
            <ResumeLibraryTab
              onOpenAnalysis={() => setTab("analysis")}
              onLoadIntoEditor={handleLoadFromHistory}
            />
          )}
          {tab === "history" && (
            <ResumeGeneratorPanel
              key={historyKey}
              activeView="history"
              onLoadIntoEditor={handleLoadFromHistory}
              onGenerated={() => setHistoryKey((k) => k + 1)}
            />
          )}
          {tab === "editor" && (
            <ResumeGeneratorPanel
              activeView="editor"
              initialJd={editorJd}
              pendingRun={pendingRun}
              onPendingRunConsumed={() => setPendingRun(null)}
              onGenerated={() => setHistoryKey((k) => k + 1)}
            />
          )}
          {tab === "analysis" && (
            <ResumeAnalysisTab onOpenLibrary={() => setTab("library")} />
          )}
        </TabTransition>
      </div>
    </PageShell>
  );
}

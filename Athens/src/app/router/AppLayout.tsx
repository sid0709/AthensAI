import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { TopNav } from "../components/layout/TopNav";
import { BackgroundAiProgressOverlay } from "../components/BackgroundAiProgressOverlay";
import { pathForView, viewFromPathname, type NavigateOptions } from "../config/routes";
import { ApplierProvider } from "../../context/applier-context";
import { AppNavigationContext } from "../context/AppNavigationContext";
import {
  JobSearchNavigationContext,
  type OpenJobSearchOptions,
} from "../context/JobSearchNavigationContext";
import {
  ResumeNavigationContext,
  type OpenEditorOptions,
  type ResumeNavigationContextValue,
} from "../context/ResumeNavigationContext";
import type { View } from "../types";
import { defaultJobSearchHref } from "../features/job-search/lib/jobSearchUrlState";
import { BackgroundTaskProvider } from "../context/BackgroundTaskContext";
import { useAuthExperience } from "../features/auth/experience/AuthExperienceContext";

function AppProviders({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const routerNavigate = useCallback(
    (view: View, options?: NavigateOptions) => {
      navigate(pathForView(view, options), { replace: options?.replace });
    },
    [navigate],
  );

  const [pendingEditorOpen, setPendingEditorOpen] = useState<OpenEditorOptions | null>(null);

  const openEditor = useCallback(
    (opts?: OpenEditorOptions) => {
      const tab = opts?.tab ?? "editor";
      if (opts?.resumeId || opts?.jd) {
        setPendingEditorOpen(opts);
      }
      routerNavigate("resumes", { tab });
    },
    [routerNavigate],
  );

  const clearPendingEditorOpen = useCallback(() => setPendingEditorOpen(null), []);

  const openJobSearch = useCallback(
    (opts?: OpenJobSearchOptions) => {
      navigate(defaultJobSearchHref(opts));
    },
    [navigate],
  );

  const resumeNav = useMemo<ResumeNavigationContextValue>(
    () => ({ openEditor, pendingEditorOpen, clearPendingEditorOpen }),
    [openEditor, pendingEditorOpen, clearPendingEditorOpen],
  );

  const jobNav = useMemo(
    () => ({ openJobSearch }),
    [openJobSearch],
  );

  const appNav = useMemo(() => ({ navigate: routerNavigate }), [routerNavigate]);

  return (
    <ApplierProvider>
      <BackgroundTaskProvider>
        <AppNavigationContext.Provider value={appNav}>
          <ResumeNavigationContext.Provider value={resumeNav}>
            <JobSearchNavigationContext.Provider value={jobNav}>{children}</JobSearchNavigationContext.Provider>
          </ResumeNavigationContext.Provider>
        </AppNavigationContext.Provider>
      </BackgroundTaskProvider>
    </ApplierProvider>
  );
}

export function AppLayout() {
  const location = useLocation();
  const active = viewFromPathname(location.pathname);
  const { markAppShellReady, transitionActive } = useAuthExperience();
  const appShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(markAppShellReady);
    return () => window.cancelAnimationFrame(frame);
  }, [markAppShellReady]);

  useEffect(() => {
    appShellRef.current?.toggleAttribute("inert", transitionActive);
  }, [transitionActive]);

  return (
    <AppProviders>
      <div
        ref={appShellRef}
        className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
        style={{ fontFamily: "'Figtree',system-ui,sans-serif" }}
        aria-hidden={transitionActive || undefined}
      >
        <Sidebar />
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <TopNav active={active} />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
        <BackgroundAiProgressOverlay />
      </div>
    </AppProviders>
  );
}

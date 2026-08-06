import { useCallback, useEffect, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { athensAuthStore } from "./auth/authStore";
import { InboxWorkspace } from "./inbox/InboxWorkspace";
import { athensInboxRepository } from "./inbox/inboxRepository";
import { JobsWorkspace } from "./jobs/JobsWorkspace";
import { athensJobsRepository } from "./jobs/jobsRepository";
import {
  formatWorkspaceRoute,
  parseWorkspaceRoute,
  type WorkspaceRoute,
  type WorkspaceView,
} from "./navigation/routes";
import { useRecordingSessionsStore } from "./recording/recordingSessionsStore";
import {
  AiAnswerPanel,
  BidOutcomeToast,
  RecordingDock,
  RecordingErrorToast,
  SubmissionDialog,
} from "./recording/RecordingExperience";
import type { FormAnswer, PageContext } from "./recording/askAi";
import { useApplicationRecording } from "./recording/useApplicationRecording";
import { useTabWorkspaceStore } from "./state/tabWorkspaceStore";
import { useWorkspaceCache } from "./state/workspaceCache";
import { invalidateWorkspaceRequests, refreshJobs, warmWorkspaceLists } from "./state/workspaceData";
import type { AuthStore, Credentials, InboxRepository, Job, JobsRepository, Session } from "./types";

interface AppProps {
  authStore?: AuthStore;
  jobsRepository?: JobsRepository;
  inboxRepository?: InboxRepository;
}

type SessionState =
  | { status: "restoring" }
  | { status: "ready"; session: Session | null };

type StoredAiAnswers = {
  jobId: string;
  answers: FormAnswer[];
  summary: string;
  pageContext: PageContext | null;
  mode: string;
};

export function App({
  authStore = athensAuthStore,
  jobsRepository = athensJobsRepository,
  inboxRepository = athensInboxRepository
}: AppProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "restoring" });
  const [aiAnswersByJob, setAiAnswersByJob] = useState<Record<string, StoredAiAnswers>>({});
  const focusedTabId = useRecordingSessionsStore((state) => state.focusedTabId);
  const tabWorkspace = useTabWorkspaceStore((state) => (
    focusedTabId == null ? null : state.byTabId[focusedTabId] ?? null
  ));
  const route = tabWorkspace?.route ?? parseWorkspaceRoute(window.location.hash);
  const aiJob = tabWorkspace?.aiJob ?? null;
  const recording = useApplicationRecording();

  const rememberAiAnswers = useCallback((payload: StoredAiAnswers) => {
    setAiAnswersByJob((current) => ({ ...current, [payload.jobId]: payload }));
  }, []);

  const navigate = useCallback((nextRoute: WorkspaceRoute) => {
    const tabId = useRecordingSessionsStore.getState().focusedTabId;
    if (tabId != null) {
      useTabWorkspaceStore.getState().setRoute(tabId, nextRoute);
    }
    const nextHash = formatWorkspaceRoute(nextRoute);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, []);

  const setAiJobForFocusedTab = useCallback((job: Job | null) => {
    const tabId = useRecordingSessionsStore.getState().focusedTabId;
    if (tabId == null) return;
    useTabWorkspaceStore.getState().setAiJob(tabId, job);
  }, []);

  // Keep each browser tab's Lens viewpoint independent.
  useEffect(() => {
    if (focusedTabId == null) return;
    const workspace = useTabWorkspaceStore.getState().ensureTab(focusedTabId);
    const nextHash = formatWorkspaceRoute(workspace.route);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [focusedTabId]);

  useEffect(() => {
    const onRemoved = (tabId: number) => {
      useTabWorkspaceStore.getState().removeTab(tabId);
    };
    const api = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome;
    api?.tabs?.onRemoved?.addListener?.(onRemoved);
    return () => api?.tabs?.onRemoved?.removeListener?.(onRemoved);
  }, []);

  useEffect(() => {
    let isActive = true;

    authStore.restore()
      .then((session) => {
        if (isActive) setSessionState({ status: "ready", session });
      })
      .catch(() => {
        if (isActive) setSessionState({ status: "ready", session: null });
      });

    return () => {
      isActive = false;
    };
  }, [authStore]);

  const activeSession = sessionState.status === "ready" ? sessionState.session : null;
  const cachedJobsCount = useWorkspaceCache((state) => activeSession
    ? state.jobsByProfile[activeSession.profileId]?.data.length
    : undefined);
  const cachedInboxUnreadCount = useWorkspaceCache((state) => activeSession
    ? state.inboxByProfile[activeSession.profileId]?.data.unreadCount
    : undefined);
  useEffect(() => {
    if (!activeSession) return;
    void warmWorkspaceLists(activeSession, jobsRepository, inboxRepository);
  }, [activeSession, inboxRepository, jobsRepository]);
  const jobsCount = cachedJobsCount ?? 0;
  const inboxUnreadCount = cachedInboxUnreadCount ?? 0;

  if (sessionState.status === "restoring") {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><img src="/logo.png" alt="" /></div>
        <p>Opening Athens Lens…</p>
      </main>
    );
  }

  const session = sessionState.session;
  if (!session) {
    return (
      <LoginScreen
        onSignIn={async (credentials: Credentials) => {
          const nextSession = await authStore.signIn(credentials);
          setSessionState({ status: "ready", session: nextSession });
          return nextSession;
        }}
      />
    );
  }

  const logout = async () => {
    const profileId = session.profileId;
    invalidateWorkspaceRequests(profileId);
    await authStore.signOut();
    useWorkspaceCache.getState().clearProfile(profileId);
    useTabWorkspaceStore.getState().clearAll();
    recording.reset();
    setAiAnswersByJob({});
    setSessionState({ status: "ready", session: null });
  };

  const navigateView = (view: WorkspaceView) => navigate({ view });
  const focusedHasBidUi = recording.state.status === "recording"
    || recording.state.status === "review"
    || recording.state.status === "saving";
  const otherRecordingCount = Math.max(
    0,
    recording.activeRecordingCount - (recording.state.status === "recording" ? 1 : 0),
  );

  const workspace = route.view === "inbox" ? (
      <InboxWorkspace
        session={session}
        inboxRepository={inboxRepository}
        route={route}
        jobsCount={jobsCount}
        onNavigate={navigate}
        onNavigateView={navigateView}
        onLogout={logout}
      />
    ) : (
    <JobsWorkspace
      session={session}
      jobsRepository={jobsRepository}
      route={route}
      inboxUnreadCount={inboxUnreadCount}
      isTabRecording={recording.state.status === "recording"}
      onNavigate={navigate}
      onNavigateView={navigateView}
      onApply={(job) => {
        void recording.openApply(job);
      }}
      onRecord={(job) => {
        void recording.startRecording(job, session);
      }}
      onAskAi={setAiJobForFocusedTab}
      onLogout={logout}
    />
  );

  const storedAi = recording.state.job ? aiAnswersByJob[recording.state.job.id] : undefined;

  return (
    <>
      {!focusedHasBidUi && otherRecordingCount > 0 ? (
        <aside className="other-tabs-recording" role="status">
          {otherRecordingCount === 1
            ? "1 bid is recording on another tab — switch to that tab to manage it."
            : `${otherRecordingCount} bids are recording on other tabs — switch tabs to manage them.`}
        </aside>
      ) : null}
      {workspace}
      <RecordingDock
        state={recording.state}
        activeRecordingCount={recording.activeRecordingCount}
        onRestart={() => void recording.restart(session)}
        onComplete={() => void recording.complete()}
        onAskAi={setAiJobForFocusedTab}
      />
      <SubmissionDialog
        state={recording.state}
        onResume={() => void recording.restart(session)}
        onFinish={async (submitted) => {
          const jobId = recording.state.job?.id;
          await recording.finish(submitted, {
            session,
            answers: storedAi?.answers,
            summary: storedAi?.summary,
            pageContext: storedAi?.pageContext,
            mode: storedAi?.mode,
          });
          if (jobId) {
            setAiAnswersByJob((current) => {
              const next = { ...current };
              delete next[jobId];
              return next;
            });
          }
          if (focusedTabId != null) {
            useTabWorkspaceStore.getState().setAiJob(focusedTabId, null);
            useTabWorkspaceStore.getState().setRoute(focusedTabId, { view: "jobs" });
            navigate({ view: "jobs" });
          }
          // Only refresh Bid Ready after a real submit — abandon stays local.
          if (submitted) {
            invalidateWorkspaceRequests(session.profileId);
            void refreshJobs(session, jobsRepository).catch(() => undefined);
          }
        }}
      />
      <AiAnswerPanel
        job={aiJob}
        session={session}
        tabId={focusedTabId}
        onAnswers={rememberAiAnswers}
        onClose={() => setAiJobForFocusedTab(null)}
      />
      <BidOutcomeToast state={recording.state} onDismiss={recording.clearOutcome} />
      <RecordingErrorToast
        message={
          recording.panelError
          || (recording.state.status === "idle" ? recording.state.error : null)
        }
        onDismiss={() => {
          recording.clearPanelError();
          recording.clearOutcome();
        }}
      />
    </>
  );
}

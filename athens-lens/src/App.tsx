import { useCallback, useEffect, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { athensAuthStore } from "./auth/authStore";
import { InboxWorkspace } from "./inbox/InboxWorkspace";
import { athensInboxRepository } from "./inbox/inboxRepository";
import { JobsWorkspace } from "./jobs/JobsWorkspace";
import { athensJobsRepository } from "./jobs/jobsRepository";
import { useWorkspaceRoute } from "./navigation/routes";
import { useWorkspaceCache } from "./state/workspaceCache";
import { invalidateWorkspaceRequests, warmWorkspaceLists } from "./state/workspaceData";
import {
  AiAnswerPanel,
  BidOutcomeToast,
  RecordingDock,
  RecordingErrorToast,
  SubmissionDialog,
} from "./recording/RecordingExperience";
import type { FormAnswer, PageContext } from "./recording/askAi";
import { useApplicationRecording } from "./recording/useApplicationRecording";
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
  const [aiJob, setAiJob] = useState<Job | null>(null);
  const [aiAnswersByJob, setAiAnswersByJob] = useState<Record<string, StoredAiAnswers>>({});
  const { route, navigate } = useWorkspaceRoute();
  const recording = useApplicationRecording();

  const rememberAiAnswers = useCallback((payload: StoredAiAnswers) => {
    setAiAnswersByJob((current) => ({ ...current, [payload.jobId]: payload }));
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
    recording.reset();
    setAiJob(null);
    setAiAnswersByJob({});
    setSessionState({ status: "ready", session: null });
  };

  const navigateView = (view: "jobs" | "inbox") => navigate({ view });
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
      recordingJobId={recording.state.status === "recording" ? recording.state.job?.id ?? null : null}
      onNavigate={navigate}
      onNavigateView={navigateView}
      onApply={(job) => {
        void recording.start(job, session);
      }}
      onAskAi={setAiJob}
      onLogout={logout}
    />
  );

  const storedAi = recording.state.job ? aiAnswersByJob[recording.state.job.id] : undefined;

  return (
    <>
      {workspace}
      <RecordingDock
        state={recording.state}
        onRestart={() => void recording.restart(session)}
        onComplete={() => void recording.complete()}
        onAskAi={setAiJob}
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
        }}
      />
      <AiAnswerPanel
        job={aiJob}
        session={session}
        tabId={recording.state.tabId}
        onAnswers={rememberAiAnswers}
        onClose={() => setAiJob(null)}
      />
      <BidOutcomeToast state={recording.state} onDismiss={recording.clearOutcome} />
      <RecordingErrorToast
        message={recording.state.status === "idle" ? recording.state.error : null}
        onDismiss={() => recording.clearOutcome()}
      />
    </>
  );
}

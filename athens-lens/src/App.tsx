import { useEffect, useState } from "react";
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
  SubmissionDialog
} from "./recording/RecordingExperience";
import { useMockRecording } from "./recording/useMockRecording";
import type { AuthStore, Credentials, InboxRepository, Job, JobsRepository, Session } from "./types";

interface AppProps {
  authStore?: AuthStore;
  jobsRepository?: JobsRepository;
  inboxRepository?: InboxRepository;
}

type SessionState =
  | { status: "restoring" }
  | { status: "ready"; session: Session | null };

export function App({
  authStore = athensAuthStore,
  jobsRepository = athensJobsRepository,
  inboxRepository = athensInboxRepository
}: AppProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "restoring" });
  const [aiJob, setAiJob] = useState<Job | null>(null);
  const { route, navigate } = useWorkspaceRoute();
  const recording = useMockRecording();

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
          const session = await authStore.signIn(credentials);
          setSessionState({ status: "ready", session });
          return session;
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
        window.open(job.applyUrl, "_blank", "noopener,noreferrer");
        recording.start(job);
      }}
      onAskAi={setAiJob}
      onLogout={logout}
    />
  );

  return (
    <>
      {workspace}
      <RecordingDock
        state={recording.state}
        onRestart={recording.restart}
        onComplete={recording.complete}
        onAskAi={setAiJob}
      />
      <SubmissionDialog
        state={recording.state}
        onResume={recording.resume}
        onFinish={recording.finish}
      />
      <AiAnswerPanel job={aiJob} onClose={() => setAiJob(null)} />
      <BidOutcomeToast state={recording.state} onDismiss={recording.clearOutcome} />
    </>
  );
}

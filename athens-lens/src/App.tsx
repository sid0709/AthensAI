import { useCallback, useEffect, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { athensAuthStore } from "./auth/authStore";
import { InboxWorkspace } from "./inbox/InboxWorkspace";
import { athensInboxRepository } from "./inbox/inboxRepository";
import { JobsWorkspace } from "./jobs/JobsWorkspace";
import { athensJobsRepository } from "./jobs/jobsRepository";
import { useWorkspaceRoute } from "./navigation/routes";
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
  const [jobsCount, setJobsCount] = useState(0);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const handleJobsLoaded = useCallback((count: number) => setJobsCount(count), []);
  const handleInboxLoaded = useCallback((count: number) => setInboxUnreadCount(count), []);
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

  if (sessionState.status === "restoring") {
    return (
      <main className="app-status" role="status">
        <div className="status-logo"><img src="/logo.png" alt="" /></div>
        <p>Opening Athens Lens…</p>
      </main>
    );
  }

  if (!sessionState.session) {
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
    await authStore.signOut();
    recording.reset();
    setAiJob(null);
    setJobsCount(0);
    setInboxUnreadCount(0);
    setSessionState({ status: "ready", session: null });
  };

  const navigateView = (view: "jobs" | "inbox") => navigate({ view });
  const workspace = route.view === "inbox" ? (
      <InboxWorkspace
        session={sessionState.session}
        inboxRepository={inboxRepository}
        route={route}
        jobsCount={jobsCount}
        onInboxLoaded={handleInboxLoaded}
        onNavigate={navigate}
        onNavigateView={navigateView}
        onLogout={logout}
      />
    ) : (
    <JobsWorkspace
      session={sessionState.session}
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
      onJobsLoaded={handleJobsLoaded}
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

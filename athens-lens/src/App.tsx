import { useEffect, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { demoAuthStore } from "./auth/authStore";
import { InboxWorkspace } from "./inbox/InboxWorkspace";
import { mockInboxRepository } from "./inbox/inboxRepository";
import { MOCK_UNREAD_COUNT } from "./inbox/mockInbox";
import { JobsWorkspace } from "./jobs/JobsWorkspace";
import { mockJobsRepository } from "./jobs/jobsRepository";
import { useWorkspaceRoute } from "./navigation/routes";
import type { AuthStore, Credentials, InboxRepository, JobsRepository, Session } from "./types";

interface AppProps {
  authStore?: AuthStore;
  jobsRepository?: JobsRepository;
  inboxRepository?: InboxRepository;
}

type SessionState =
  | { status: "restoring" }
  | { status: "ready"; session: Session | null };

export function App({
  authStore = demoAuthStore,
  jobsRepository = mockJobsRepository,
  inboxRepository = mockInboxRepository
}: AppProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "restoring" });
  const { route, navigate } = useWorkspaceRoute();

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
    setSessionState({ status: "ready", session: null });
  };

  const navigateView = (view: "jobs" | "inbox") => navigate({ view });

  if (route.view === "inbox") {
    return (
      <InboxWorkspace
        session={sessionState.session}
        inboxRepository={inboxRepository}
        route={route}
        inboxUnreadCount={MOCK_UNREAD_COUNT}
        onNavigate={navigate}
        onNavigateView={navigateView}
        onLogout={logout}
      />
    );
  }

  return (
    <JobsWorkspace
      session={sessionState.session}
      jobsRepository={jobsRepository}
      route={route}
      inboxUnreadCount={MOCK_UNREAD_COUNT}
      onNavigate={navigate}
      onNavigateView={navigateView}
      onLogout={logout}
    />
  );
}

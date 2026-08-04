import { useEffect, useState } from "react";
import { LoginScreen } from "./auth/LoginScreen";
import { demoAuthStore } from "./auth/authStore";
import { JobsWorkspace } from "./jobs/JobsWorkspace";
import { mockJobsRepository } from "./jobs/jobsRepository";
import type { AuthStore, Credentials, JobsRepository, Session } from "./types";

interface AppProps {
  authStore?: AuthStore;
  jobsRepository?: JobsRepository;
}

type SessionState =
  | { status: "restoring" }
  | { status: "ready"; session: Session | null };

export function App({ authStore = demoAuthStore, jobsRepository = mockJobsRepository }: AppProps) {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "restoring" });

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

  return (
    <JobsWorkspace
      session={sessionState.session}
      jobsRepository={jobsRepository}
      onLogout={async () => {
        await authStore.signOut();
        setSessionState({ status: "ready", session: null });
      }}
    />
  );
}

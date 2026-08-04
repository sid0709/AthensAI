import { AlertCircle, BriefcaseBusiness, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AthensApiError } from "../api/athensApi";
import type { WorkspaceRoute, WorkspaceView } from "../navigation/routes";
import type { Job, JobsRepository, Session } from "../types";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";

interface JobsWorkspaceProps {
  session: Session;
  jobsRepository: JobsRepository;
  route: WorkspaceRoute;
  inboxUnreadCount: number;
  recordingJobId: string | null;
  onNavigate(route: WorkspaceRoute): void;
  onNavigateView(view: WorkspaceView): void;
  onApply(job: Job): void;
  onAskAi(job: Job): void;
  onJobsLoaded(count: number): void;
  onLogout(): Promise<void>;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; jobs: readonly Job[] };

export function JobsWorkspace({
  session,
  jobsRepository,
  route,
  inboxUnreadCount,
  recordingJobId,
  onNavigate,
  onNavigateView,
  onApply,
  onAskAi,
  onJobsLoaded,
  onLogout
}: JobsWorkspaceProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isActive = true;

    jobsRepository.listJobs(session).then(
      (jobs) => {
        if (!isActive) return;
        setLoadState({ status: "ready", jobs });
        onJobsLoaded(jobs.length);
      },
      (error) => {
        if (isActive) {
          setLoadState({
            status: "error",
            message: error instanceof AthensApiError ? error.message : "Jobs couldn't be loaded."
          });
        }
      }
    );

    return () => {
      isActive = false;
    };
  }, [jobsRepository, loadAttempt, onJobsLoaded, session]);

  if (loadState.status === "loading") {
    return <AppStatus label="Loading jobs…" />;
  }

  if (loadState.status === "error") {
    return (
      <AppStatus
        label={loadState.message}
        icon={<AlertCircle size={24} aria-hidden="true" />}
        action={
          <div className="status-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setLoadState({ status: "loading" });
                setLoadAttempt((current) => current + 1);
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />Try again
            </button>
            <button className="text-button" type="button" onClick={() => void onLogout()}>
              Sign out
            </button>
          </div>
        }
      />
    );
  }

  const selectedJobId = route.itemId ?? loadState.jobs[0]?.id ?? null;
  const selectedJob = loadState.jobs.find((job) => job.id === selectedJobId) ?? loadState.jobs[0] ?? null;

  if (loadState.jobs.length === 0) {
    return <AppStatus label="No jobs to show yet." icon={<BriefcaseBusiness size={24} aria-hidden="true" />} />;
  }

  return (
    <main className={`workspace workspace--${route.itemId ? "detail" : "list"}`}>
      <JobList
        jobs={loadState.jobs}
        selectedJobId={selectedJobId}
        session={session}
        inboxUnreadCount={inboxUnreadCount}
        onSelect={(jobId) => {
          onNavigate({ view: "jobs", itemId: jobId });
        }}
        onNavigate={onNavigateView}
        onLogout={() => void onLogout()}
      />
      {selectedJob ? (
        <JobDetail
          job={selectedJob}
          isRecording={recordingJobId === selectedJob.id}
          onBack={() => onNavigate({ view: "jobs" })}
          onApply={onApply}
          onAskAi={onAskAi}
        />
      ) : null}
    </main>
  );
}

interface AppStatusProps {
  label: string;
  icon?: ReactNode;
  action?: ReactNode;
}

function AppStatus({ label, icon, action }: AppStatusProps) {
  return (
    <main className="app-status" role="status">
      <div className="status-logo">{icon ?? <img src="/logo.png" alt="" />}</div>
      <p>{label}</p>
      {action}
    </main>
  );
}

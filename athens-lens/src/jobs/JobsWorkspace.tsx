import { AlertCircle, BriefcaseBusiness, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AthensApiError } from "../api/athensApi";
import type { WorkspaceRoute, WorkspaceView } from "../navigation/routes";
import { useWorkspaceCache } from "../state/workspaceCache";
import { refreshJobs } from "../state/workspaceData";
import type { Job, JobsRepository, Session } from "../types";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";

interface JobsWorkspaceProps {
  session: Session;
  jobsRepository: JobsRepository;
  route: WorkspaceRoute;
  inboxUnreadCount: number;
  recordingJobIds: readonly string[];
  onNavigate(route: WorkspaceRoute): void;
  onNavigateView(view: WorkspaceView): void;
  onApply(job: Job): void;
  onAskAi(job: Job): void;
  onLogout(): Promise<void>;
}

export function JobsWorkspace({
  session,
  jobsRepository,
  route,
  inboxUnreadCount,
  recordingJobIds,
  onNavigate,
  onNavigateView,
  onApply,
  onAskAi,
  onLogout
}: JobsWorkspaceProps) {
  const jobs = useWorkspaceCache((state) => state.jobsByProfile[session.profileId]?.data);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const requestKey = `${session.profileId}:${loadAttempt}`;

  useEffect(() => {
    let isActive = true;

    refreshJobs(session, jobsRepository).then(
      () => undefined,
      (error) => {
        if (isActive) {
          setLoadError({
            key: requestKey,
            message: error instanceof AthensApiError ? error.message : "Jobs couldn't be loaded."
          });
        }
      }
    );

    return () => {
      isActive = false;
    };
  }, [jobsRepository, requestKey, session]);

  const currentError = loadError?.key === requestKey ? loadError.message : null;

  if (!jobs && !currentError) {
    return <AppStatus label="Loading jobs…" />;
  }

  if (!jobs && currentError) {
    return (
      <AppStatus
        label={currentError}
        icon={<AlertCircle size={24} aria-hidden="true" />}
        action={
          <div className="status-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
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

  const visibleJobs = jobs ?? [];
  const selectedJobId = route.itemId ?? visibleJobs[0]?.id ?? null;
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) ?? visibleJobs[0] ?? null;

  if (visibleJobs.length === 0) {
    return <AppStatus label="No jobs to show yet." icon={<BriefcaseBusiness size={24} aria-hidden="true" />} />;
  }

  return (
    <main className={`workspace workspace--${route.itemId ? "detail" : "list"}`}>
      <JobList
        jobs={visibleJobs}
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
          isRecording={recordingJobIds.includes(selectedJob.id)}
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

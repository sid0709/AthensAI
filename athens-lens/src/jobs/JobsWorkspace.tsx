import { AlertCircle, BriefcaseBusiness, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Job, JobsRepository, Session } from "../types";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";

interface JobsWorkspaceProps {
  session: Session;
  jobsRepository: JobsRepository;
  onLogout(): Promise<void>;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; jobs: readonly Job[] };

export function JobsWorkspace({ session, jobsRepository, onLogout }: JobsWorkspaceProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isActive = true;

    jobsRepository.listJobs().then(
      (jobs) => {
        if (!isActive) return;
        setLoadState({ status: "ready", jobs });
        setSelectedJobId((current) => current ?? jobs[0]?.id ?? null);
      },
      () => {
        if (isActive) setLoadState({ status: "error" });
      }
    );

    return () => {
      isActive = false;
    };
  }, [jobsRepository, loadAttempt]);

  if (loadState.status === "loading") {
    return <AppStatus label="Loading jobs…" />;
  }

  if (loadState.status === "error") {
    return (
      <AppStatus
        label="Jobs couldn't be loaded."
        icon={<AlertCircle size={24} aria-hidden="true" />}
        action={
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
        }
      />
    );
  }

  const selectedJob = loadState.jobs.find((job) => job.id === selectedJobId) ?? null;

  if (loadState.jobs.length === 0) {
    return <AppStatus label="No jobs to show yet." icon={<BriefcaseBusiness size={24} aria-hidden="true" />} />;
  }

  return (
    <main className={`workspace workspace--${mobilePane}`}>
      <JobList
        jobs={loadState.jobs}
        selectedJobId={selectedJobId}
        session={session}
        onSelect={(jobId) => {
          setSelectedJobId(jobId);
          setMobilePane("detail");
        }}
        onLogout={() => void onLogout()}
      />
      {selectedJob ? <JobDetail job={selectedJob} onBack={() => setMobilePane("list")} /> : null}
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

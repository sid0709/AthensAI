import { AlertCircle, BriefcaseBusiness, ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AthensApiError } from "../api/athensApi";
import type { WorkspaceRoute, WorkspaceView } from "../navigation/routes";
import { skipAthensLensBid } from "../recording/bidPersist";
import { useWorkspaceCache } from "../state/workspaceCache";
import { invalidateWorkspaceRequests, refreshJobs } from "../state/workspaceData";
import type { Job, JobsRepository, Session } from "../types";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";

interface JobsWorkspaceProps {
  session: Session;
  jobsRepository: JobsRepository;
  route: WorkspaceRoute;
  inboxUnreadCount: number;
  isTabRecording: boolean;
  onNavigate(route: WorkspaceRoute): void;
  onNavigateView(view: WorkspaceView): void;
  onApply(job: Job): void;
  onRecord(job: Job): void;
  onAskAi(job: Job): void;
  onLogout(): Promise<void>;
}

export function JobsWorkspace({
  session,
  jobsRepository,
  route,
  inboxUnreadCount,
  isTabRecording,
  onNavigate,
  onNavigateView,
  onApply,
  onRecord,
  onAskAi,
  onLogout
}: JobsWorkspaceProps) {
  const jobs = useWorkspaceCache((state) => state.jobsByProfile[session.profileId]?.data);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [skipTarget, setSkipTarget] = useState<Job | null>(null);
  const [skippingJobId, setSkippingJobId] = useState<string | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const requestKey = session.profileId;

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

  async function handleRefresh() {
    setRefreshing(true);
    invalidateWorkspaceRequests(session.profileId);
    try {
      await refreshJobs(session, jobsRepository);
      setLoadError(null);
    } catch (error) {
      const hasJobs = Boolean(useWorkspaceCache.getState().jobsByProfile[session.profileId]?.data);
      if (!hasJobs) {
        setLoadError({
          key: requestKey,
          message: error instanceof AthensApiError ? error.message : "Jobs couldn't be loaded."
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function confirmSkip() {
    const job = skipTarget;
    if (!job) return;
    setSkipError(null);
    setSkippingJobId(job.id);
    try {
      await skipAthensLensBid(session, job.id);
      useWorkspaceCache.getState().removeJob(session.profileId, job.id);
      setSkipTarget(null);
      invalidateWorkspaceRequests(session.profileId);
      void refreshJobs(session, jobsRepository).catch(() => undefined);
      const remaining = useWorkspaceCache.getState().jobsByProfile[session.profileId]?.data ?? [];
      const nextId = remaining[0]?.id;
      onNavigate(nextId ? { view: "jobs", itemId: nextId } : { view: "jobs" });
    } catch (error) {
      setSkipError(error instanceof AthensApiError ? error.message : "Could not skip this job.");
    } finally {
      setSkippingJobId(null);
    }
  }

  const refreshAction = (
    <div className="status-actions">
      <button
        className="secondary-button"
        type="button"
        disabled={refreshing}
        onClick={() => void handleRefresh()}
      >
        <RefreshCw size={16} aria-hidden="true" className={refreshing ? "spin" : undefined} />
        Refresh
      </button>
      <button className="text-button" type="button" onClick={() => void onLogout()}>
        Sign out
      </button>
    </div>
  );

  if (!jobs && !currentError) {
    return <AppStatus label="Loading jobs…" />;
  }

  if (!jobs && currentError) {
    return (
      <AppStatus
        label={currentError}
        icon={<AlertCircle size={24} aria-hidden="true" />}
        action={refreshAction}
      />
    );
  }

  const visibleJobs = jobs ?? [];
  const selectedJobId = route.itemId ?? visibleJobs[0]?.id ?? null;
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) ?? visibleJobs[0] ?? null;

  if (visibleJobs.length === 0) {
    return (
      <AppStatus
        label="Nothing in Bid Ready yet. Refresh after jobs are added."
        icon={<BriefcaseBusiness size={24} aria-hidden="true" />}
        action={refreshAction}
      />
    );
  }

  return (
    <main className={`workspace workspace--${route.itemId ? "detail" : "list"}`}>
      <JobList
        jobs={visibleJobs}
        selectedJobId={selectedJobId}
        session={session}
        inboxUnreadCount={inboxUnreadCount}
        skippingJobId={skippingJobId}
        refreshing={refreshing}
        onSelect={(jobId) => {
          onNavigate({ view: "jobs", itemId: jobId });
        }}
        onSkip={(job) => {
          setSkipError(null);
          setSkipTarget(job);
        }}
        onRefresh={() => void handleRefresh()}
        onNavigate={onNavigateView}
        onLogout={() => void onLogout()}
      />
      {selectedJob ? (
        <JobDetail
          job={selectedJob}
          isRecording={isTabRecording}
          skipping={skippingJobId === selectedJob.id}
          onBack={() => onNavigate({ view: "jobs" })}
          onApply={onApply}
          onRecord={onRecord}
          onAskAi={onAskAi}
          onSkip={(job) => {
            setSkipError(null);
            setSkipTarget(job);
          }}
        />
      ) : null}
      {skipTarget ? (
        <SkipConfirmDialog
          job={skipTarget}
          error={skipError}
          saving={skippingJobId === skipTarget.id}
          onCancel={() => {
            setSkipTarget(null);
            setSkipError(null);
          }}
          onConfirm={() => void confirmSkip()}
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

interface SkipConfirmDialogProps {
  job: Job;
  error: string | null;
  saving: boolean;
  onCancel(): void;
  onConfirm(): void;
}

function SkipConfirmDialog({ job, error, saving, onCancel, onConfirm }: SkipConfirmDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="skip-title">
        <span className="dialog-icon" aria-hidden="true"><ClipboardCheck size={22} /></span>
        <h2 id="skip-title">Mark this job as Skipped?</h2>
        <p>
          {job.title} will leave Bid Ready and show as Skipped in Bid Management.
        </p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        {saving ? (
          <p className="ai-loading" role="status">
            <Loader2 size={18} className="spin" aria-hidden="true" />
            Marking as skipped…
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="primary-button" type="button" disabled={saving} onClick={onConfirm}>
            Skip job
          </button>
          <button className="secondary-button" type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

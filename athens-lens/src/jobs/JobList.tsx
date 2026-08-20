import { MapPin } from "lucide-react";
import { WorkspaceSidebar } from "../navigation/WorkspaceSidebar";
import type { WorkspaceView } from "../navigation/routes";
import type { Job, Session } from "../types";
import { CompanyLogo } from "./CompanyLogo";

interface JobListProps {
  jobs: readonly Job[];
  selectedJobId: string | null;
  session: Session;
  inboxUnreadCount: number;
  skippingJobId?: string | null;
  refreshing?: boolean;
  onSelect(jobId: string): void;
  onSkip(job: Job): void;
  onRefresh(): void;
  onNavigate(view: WorkspaceView): void;
  onLogout(): void;
}

export function JobList({
  jobs,
  selectedJobId,
  session,
  inboxUnreadCount,
  skippingJobId = null,
  refreshing = false,
  onSelect,
  onSkip,
  onRefresh,
  onNavigate,
  onLogout
}: JobListProps) {
  return (
    <WorkspaceSidebar
      activeView="jobs"
      title="Jobs"
      count={jobs.length}
      countLabel={`${jobs.length} jobs`}
      jobsCount={jobs.length}
      inboxUnreadCount={inboxUnreadCount}
      session={session}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <nav className="job-list" aria-label="Available jobs">
        {jobs.map((job) => {
          const isSelected = selectedJobId === job.id;
          const skipping = skippingJobId === job.id;
          return (
            <div
              className={`job-list-row${isSelected ? " job-list-row--selected" : ""}`}
              key={job.id}
            >
              <button
                className="job-list-item"
                type="button"
                aria-current={isSelected ? "page" : undefined}
                onClick={() => onSelect(job.id)}
              >
                <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="list" />
                <span className="job-list-copy">
                  <strong>{job.title}</strong>
                  <span>{job.company}</span>
                  <span className="job-list-location"><MapPin size={12} />{job.location}</span>
                </span>
              </button>
              <button
                className="job-list-skip"
                type="button"
                disabled={skipping}
                onClick={() => onSkip(job)}
              >
                Skip
              </button>
            </div>
          );
        })}
      </nav>
    </WorkspaceSidebar>
  );
}

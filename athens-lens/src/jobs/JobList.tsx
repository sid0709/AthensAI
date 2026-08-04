import { BriefcaseBusiness, MapPin } from "lucide-react";
import { WorkspaceSidebar } from "../navigation/WorkspaceSidebar";
import type { WorkspaceView } from "../navigation/routes";
import type { Job, Session } from "../types";

interface JobListProps {
  jobs: readonly Job[];
  selectedJobId: string | null;
  session: Session;
  inboxUnreadCount: number;
  onSelect(jobId: string): void;
  onNavigate(view: WorkspaceView): void;
  onLogout(): void;
}

export function JobList({
  jobs,
  selectedJobId,
  session,
  inboxUnreadCount,
  onSelect,
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
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      <nav className="job-list" aria-label="Available jobs">
        {jobs.map((job) => {
          const isSelected = selectedJobId === job.id;
          return (
            <button
              className="job-list-item"
              key={job.id}
              type="button"
              aria-current={isSelected ? "page" : undefined}
              onClick={() => onSelect(job.id)}
            >
              <span className="job-list-icon" aria-hidden="true">
                <BriefcaseBusiness size={16} />
              </span>
              <span className="job-list-copy">
                <strong>{job.title}</strong>
                <span>{job.company}</span>
                <span className="job-list-location"><MapPin size={12} />{job.location}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </WorkspaceSidebar>
  );
}

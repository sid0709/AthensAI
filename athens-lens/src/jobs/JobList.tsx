import { BriefcaseBusiness, LogOut, MapPin } from "lucide-react";
import type { Job, Session } from "../types";

interface JobListProps {
  jobs: readonly Job[];
  selectedJobId: string | null;
  session: Session;
  onSelect(jobId: string): void;
  onLogout(): void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function JobList({ jobs, selectedJobId, session, onSelect, onLogout }: JobListProps) {
  return (
    <aside className="job-navigation" aria-label="Jobs">
      <header className="navigation-header">
        <div className="brand-lockup">
          <img src="/logo.png" alt="" />
          <span>Athens Lens</span>
        </div>
      </header>

      <div className="job-list-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Jobs</h1>
        </div>
        <span className="job-count" aria-label={`${jobs.length} jobs`}>{jobs.length}</span>
      </div>

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

      <footer className="user-footer">
        <span className="user-avatar" aria-hidden="true">{initials(session.displayName)}</span>
        <span className="user-copy">
          <strong>{session.displayName}</strong>
          <span>{session.email}</span>
        </span>
        <button className="icon-button" type="button" aria-label="Log out" onClick={onLogout}>
          <LogOut size={18} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}

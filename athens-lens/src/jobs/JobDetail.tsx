import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, CalendarDays, MapPin } from "lucide-react";
import type { Job } from "../types";

interface JobDetailProps {
  job: Job;
  onBack(): void;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

function formatPostedAt(value: string): string {
  return DATE_FORMAT.format(new Date(`${value}T00:00:00Z`));
}

export function JobDetail({ job, onBack }: JobDetailProps) {
  return (
    <article className="job-detail" aria-labelledby="job-detail-title">
      <header className="detail-toolbar">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>All jobs</span>
        </button>
        <span className="detail-toolbar-label">Job details</span>
      </header>

      <div className="detail-scroll">
        <div className="detail-content">
          <section className="detail-hero">
            <div className="company-mark" aria-hidden="true">{job.company.charAt(0)}</div>
            <div className="detail-title-group">
              <p className="company-name">{job.company}</p>
              <h1 id="job-detail-title">{job.title}</h1>
              <p className="job-summary">{job.summary}</p>
            </div>
          </section>

          <dl className="job-metadata">
            <div>
              <dt><MapPin size={16} aria-hidden="true" />Location</dt>
              <dd>{job.location} · {job.workMode}</dd>
            </div>
            <div>
              <dt><BriefcaseBusiness size={16} aria-hidden="true" />Employment</dt>
              <dd>{job.employmentType}</dd>
            </div>
            <div>
              <dt><CalendarDays size={16} aria-hidden="true" />Posted</dt>
              <dd>{formatPostedAt(job.postedAt)}</dd>
            </div>
          </dl>

          <section className="detail-section">
            <h2>About the role</h2>
            <p>{job.description}</p>
          </section>

          <section className="detail-section">
            <h2>What you'll do</h2>
            <ul>
              {job.responsibilities.map((responsibility) => <li key={responsibility}>{responsibility}</li>)}
            </ul>
          </section>

          <section className="detail-section">
            <h2>What you'll bring</h2>
            <ul>
              {job.qualifications.map((qualification) => <li key={qualification}>{qualification}</li>)}
            </ul>
          </section>
        </div>
      </div>

      <footer className="detail-footer">
        <a className="primary-button detail-action" href={job.applyUrl} target="_blank" rel="noreferrer">
          <span>View job</span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      </footer>
    </article>
  );
}

import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, CalendarDays, MapPin, Sparkles, Video } from "lucide-react";
import type { Job } from "../types";

interface JobDetailProps {
  job: Job;
  isRecording: boolean;
  onBack(): void;
  onApply(job: Job): void;
  onAskAi(job: Job): void;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

function formatPostedAt(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return value && !Number.isNaN(date.getTime()) ? DATE_FORMAT.format(date) : "Not listed";
}

export function JobDetail({ job, isRecording, onBack, onApply, onAskAi }: JobDetailProps) {
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

          {job.responsibilities.length > 0 ? (
            <section className="detail-section">
              <h2>What you'll do</h2>
              <ul>
                {job.responsibilities.map((responsibility) => <li key={responsibility}>{responsibility}</li>)}
              </ul>
            </section>
          ) : null}

          {job.qualifications.length > 0 ? (
            <section className="detail-section">
              <h2>What you'll bring</h2>
              <ul>
                {job.qualifications.map((qualification) => <li key={qualification}>{qualification}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <footer className="detail-footer">
        <button className="secondary-button ai-action" type="button" onClick={() => onAskAi(job)}>
          <Sparkles size={17} aria-hidden="true" />
          Ask AI
        </button>
        <button
          className="primary-button detail-action"
          type="button"
          disabled={isRecording || !job.applyUrl}
          onClick={() => onApply(job)}
        >
          {isRecording ? <Video size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
          <span>{isRecording ? "Recording active" : job.applyUrl ? "Apply & record" : "Link unavailable"}</span>
        </button>
      </footer>
    </article>
  );
}

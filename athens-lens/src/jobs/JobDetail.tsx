import {
  ArrowLeft,
  ArrowUpRight,
  BookMarked,
  CalendarDays,
  Sparkles,
  Video
} from "lucide-react";
import type { Job } from "../types";
import { CompanyLogo } from "./CompanyLogo";

interface JobDetailProps {
  job: Job;
  isRecording: boolean;
  skipping?: boolean;
  onBack(): void;
  onApply(job: Job): void;
  onRecord(job: Job): void;
  onAskAi(job: Job): void;
  onSkip(job: Job): void;
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

export function JobDetail({
  job,
  isRecording,
  skipping = false,
  onBack,
  onApply,
  onRecord,
  onAskAi,
  onSkip
}: JobDetailProps) {
  const hasRecommendation = Boolean(job.recommendedResumeStack) || Boolean(job.useCustomizedResume);

  return (
    <article className="job-detail" aria-labelledby="job-detail-title">
      <header className="detail-toolbar">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>All jobs</span>
        </button>
        <div className="detail-toolbar-actions">
          <button
            className="text-button"
            type="button"
            disabled={isRecording || skipping}
            onClick={() => onSkip(job)}
          >
            Skip
          </button>
          <button
            className="record-header-button"
            type="button"
            disabled={isRecording}
            onClick={() => onRecord(job)}
          >
            <Video size={16} aria-hidden="true" />
            <span>{isRecording ? "Recording" : "Record"}</span>
          </button>
          <span className="detail-toolbar-label">Job details</span>
        </div>
      </header>

      <div className="detail-scroll">
        <div className="detail-content">
          <section className="detail-hero">
            <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="detail" />
            <div className="detail-title-group">
              <p className="company-name">{job.company}</p>
              <h1 id="job-detail-title">{job.title}</h1>
              {job.postedAt ? (
                <p className="job-posted-date">
                  <CalendarDays size={14} aria-hidden="true" />Posted {formatPostedAt(job.postedAt)}
                </p>
              ) : null}
            </div>
          </section>

          <section
            className={`recommended-resume-banner${hasRecommendation ? "" : " recommended-resume-banner--empty"}`}
            aria-label="Recommended resume"
          >
            <div className="recommended-resume-banner__icon" aria-hidden="true">
              <BookMarked size={22} />
            </div>
            <div className="recommended-resume-banner__body">
              <p className="recommended-resume-banner__eyebrow">Recommended resume</p>
              <h2 className="recommended-resume-banner__title">
                {hasRecommendation
                  ? job.recommendedResumeStack || "Customized resume"
                  : "Not recommended yet"}
              </h2>
            </div>
          </section>

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
          disabled={!job.applyUrl}
          onClick={() => onApply(job)}
        >
          <ArrowUpRight size={18} aria-hidden="true" />
          <span>{job.applyUrl ? "Apply" : "Link unavailable"}</span>
        </button>
      </footer>
    </article>
  );
}

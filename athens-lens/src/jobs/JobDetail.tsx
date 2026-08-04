import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  GraduationCap,
  MapPin,
  Sparkles,
  Tag,
  Users,
  Video,
  Wifi
} from "lucide-react";
import type { ReactNode } from "react";
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

function hasValue(value: string): boolean {
  return Boolean(value && value !== "Not specified" && value !== "—");
}

function JobChip({ children, icon, skill = false }: { children: ReactNode; icon?: ReactNode; skill?: boolean }) {
  return <span className={`job-chip${skill ? " job-chip--skill" : ""}`}>{icon}{children}</span>;
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
              <div className="job-tag-groups">
                {job.skills.length > 0 ? (
                  <div className="job-chip-row" aria-label="Job skills">
                    {job.skills.slice(0, 6).map((skill) => <JobChip key={skill} skill>{skill}</JobChip>)}
                    {job.skills.length > 6 ? <JobChip skill>+{job.skills.length - 6} more</JobChip> : null}
                  </div>
                ) : null}
                <div className="job-chip-row" aria-label="Job details">
                  {hasValue(job.location) ? <JobChip icon={<MapPin size={12} aria-hidden="true" />}>{job.location}</JobChip> : null}
                  {hasValue(job.workMode) ? <JobChip icon={<Wifi size={12} aria-hidden="true" />}>{job.workMode}</JobChip> : null}
                  {hasValue(job.employmentType) ? <JobChip icon={<BriefcaseBusiness size={12} aria-hidden="true" />}>{job.employmentType}</JobChip> : null}
                  {hasValue(job.seniority) ? <JobChip icon={<GraduationCap size={12} aria-hidden="true" />}>{job.seniority}</JobChip> : null}
                  {job.experience ? <JobChip>{job.experience}</JobChip> : null}
                  {job.salary ? <JobChip icon={<Banknote size={12} aria-hidden="true" />}>{job.salary}</JobChip> : null}
                  {job.applicantsText ? <JobChip icon={<Users size={12} aria-hidden="true" />}>{job.applicantsText}</JobChip> : null}
                  {job.postedAt ? <JobChip icon={<CalendarDays size={12} aria-hidden="true" />}>{formatPostedAt(job.postedAt)}</JobChip> : null}
                  {job.tags.map((tag) => <JobChip key={tag} icon={<Tag size={12} aria-hidden="true" />}>{tag}</JobChip>)}
                </div>
              </div>
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

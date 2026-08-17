import {
  CalendarClock,
  Check,
  GitMerge,
  Package,
  Puzzle,
  Rocket,
  ScrollText,
  Sparkles,
  Tag,
} from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { cn } from "../../lib/utils";
import { CHANGELOG_LAST_UPDATED, CHANGELOG_MILESTONES, type ChangelogMilestone } from "./milestones";

function formatLongDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function milestoneIcon(id: string) {
  if (id === "mail-ai-label") return ScrollText;
  if (id === "apps-plugins") return Puzzle;
  if (id === "vendor-management") return GitMerge;
  return Rocket;
}

function MilestoneCard({ milestone }: { milestone: ChangelogMilestone }) {
  const Icon = milestoneIcon(milestone.id);

  return (
    <article
      className={cn("athens-card", milestone.current && "is-selected")}
      aria-current={milestone.current ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2">
          <span className="athens-changelog__icon">
            <Icon size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="athens-changelog__title">{milestone.title}</h2>
            <p className="athens-card-meta mt-1">
              <span className="inline-flex items-center gap-1">
                <Package size={12} aria-hidden="true" />
                v{milestone.version}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={12} aria-hidden="true" />
                {formatLongDate(milestone.date)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <GitMerge size={12} aria-hidden="true" />
                {milestone.merge}
              </span>
            </p>
          </div>
        </div>
        {milestone.current ? (
          <span className="athens-status shrink-0">
            <Sparkles size={14} aria-hidden="true" />
            Current
          </span>
        ) : null}
      </div>

      <p className="athens-changelog__summary">{milestone.summary}</p>

      <div className="athens-changelog__tags">
        {milestone.tags.map((tag) => (
          <span key={tag} className="athens-chip">
            <Tag size={12} aria-hidden="true" />
            {tag}
          </span>
        ))}
      </div>

      <ul className="athens-changelog__changes">
        {milestone.changes.map((change) => (
          <li key={change} className="athens-changelog__change">
            <Check size={16} className="athens-changelog__change-icon" aria-hidden="true" />
            <span>{change}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ChangelogPage() {
  const lastUpdated = formatLongDate(CHANGELOG_LAST_UPDATED);

  return (
    <PageShell className="athens-ui">
      <div className="athens-toolbar mb-2">
        <div className="athens-surface">
          <div className="athens-toolbar-row">
            <p className="athens-changelog__intro">
              What shipped with each release, newest first.
            </p>
            <div className="athens-toolbar-actions ml-auto">
              <span className="athens-status">
                <CalendarClock size={16} aria-hidden="true" />
                Last updated {lastUpdated}
              </span>
              <span className="athens-count">{CHANGELOG_MILESTONES.length}</span>
            </div>
          </div>
        </div>
      </div>

      <ol className="athens-changelog">
        {CHANGELOG_MILESTONES.map((milestone) => (
          <li key={milestone.id}>
            <MilestoneCard milestone={milestone} />
          </li>
        ))}
      </ol>
    </PageShell>
  );
}

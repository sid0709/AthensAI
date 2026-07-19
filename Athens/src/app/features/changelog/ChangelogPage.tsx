import { motion } from "motion/react";
import {
  CalendarClock,
  GitMerge,
  Package,
  Puzzle,
  Rocket,
  ScrollText,
  Sparkles,
  Tag,
} from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { cn, display, mono } from "../../lib/utils";
import { CHANGELOG_LAST_UPDATED, CHANGELOG_MILESTONES, type ChangelogMilestone } from "./milestones";

const ease = [0.22, 1, 0.36, 1] as const;

function formatLongDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function milestoneIcon(id: string) {
  if (id === "apps-plugins") return Puzzle;
  if (id === "vendor-management") return GitMerge;
  return Rocket;
}

function MilestoneCard({
  milestone,
  index,
  isLast,
}: {
  milestone: ChangelogMilestone;
  index: number;
  isLast: boolean;
}) {
  const Icon = milestoneIcon(milestone.id);

  return (
    <motion.li
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.12 + index * 0.1, ease }}
      className="relative flex gap-4 sm:gap-6"
    >
      {/* Rail */}
      <div className="relative flex flex-col items-center shrink-0 w-11 sm:w-12">
        <div
          className={cn(
            "relative z-10 grid place-items-center w-11 h-11 sm:w-12 sm:h-12 rounded-2xl border shadow-sm",
            milestone.current
              ? "bg-primary text-primary-foreground border-primary/40 shadow-primary/25"
              : "bg-card text-primary border-border",
          )}
        >
          <Icon className="w-5 h-5" />
          {milestone.current && (
            <span className="absolute -inset-1 rounded-2xl bg-primary/20 blur-md -z-10" />
          )}
        </div>
        {!isLast && (
          <div className="w-px flex-1 min-h-[2rem] mt-2 bg-gradient-to-b from-border via-border to-transparent" />
        )}
      </div>

      {/* Card */}
      <article
        className={cn(
          "flex-1 min-w-0 mb-8 sm:mb-10 rounded-2xl border bg-card shadow-[var(--shadow-sm)] overflow-hidden",
          milestone.current
            ? "border-primary/30 ring-1 ring-primary/15"
            : "border-border/80",
        )}
      >
        <div
          className={cn(
            "px-5 sm:px-6 pt-5 pb-4 border-b border-border/70",
            milestone.current
              ? "bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent"
              : "bg-secondary/20",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary text-[11px] font-bold text-muted-foreground"
              style={mono}
            >
              <Package className="w-3 h-3" />
              v{milestone.version}
            </span>
            {milestone.current && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                <Sparkles className="w-3 h-3" />
                Current
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <CalendarClock className="w-3.5 h-3.5" />
              {formatLongDate(milestone.date)}
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground" style={display}>
            {milestone.title}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed max-w-2xl">
            {milestone.summary}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-bold"
              style={mono}
            >
              <GitMerge className="w-3 h-3" />
              {milestone.merge}
            </span>
            {milestone.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary text-[11px] font-bold text-muted-foreground"
              >
                <Tag className="w-3 h-3 opacity-70" />
                {tag}
              </span>
            ))}
          </div>
        </div>

        <ul className="px-5 sm:px-6 py-4 space-y-2.5">
          {milestone.changes.map((change) => (
            <li key={change} className="flex items-start gap-2.5 text-sm text-foreground/90 leading-relaxed">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
              <span>{change}</span>
            </li>
          ))}
        </ul>
      </article>
    </motion.li>
  );
}

export function ChangelogPage() {
  const lastUpdated = formatLongDate(CHANGELOG_LAST_UPDATED);

  return (
    <PageShell className="bg-background">
      <div className="relative max-w-3xl mx-auto">
        {/* Soft atmosphere */}
        <div className="pointer-events-none absolute -top-10 -left-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute top-40 -right-16 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />

        <motion.header
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="relative mb-8 sm:mb-10 space-y-3"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold tracking-wide">
            <ScrollText className="w-3.5 h-3.5" />
            Product updates
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground" style={display}>
            Changelog
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl">
            What shipped with each merge — releases, infrastructure, and extensions — in order from
            newest to oldest.
          </p>
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground pt-1">
            <CalendarClock className="w-3.5 h-3.5 text-primary" />
            Last updated
            <span className="text-foreground font-bold" style={mono}>
              {lastUpdated}
            </span>
          </p>
        </motion.header>

        <ol className="relative list-none m-0 p-0">
          {CHANGELOG_MILESTONES.map((milestone, index) => (
            <MilestoneCard
              key={milestone.id}
              milestone={milestone}
              index={index}
              isLast={index === CHANGELOG_MILESTONES.length - 1}
            />
          ))}
        </ol>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="text-xs text-muted-foreground text-center pb-4"
        >
          {CHANGELOG_MILESTONES.length} milestones · Athens release notes
        </motion.p>
      </div>
    </PageShell>
  );
}

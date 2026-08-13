import React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { Job } from "../../../types";

type JobUrlLinkProps = {
  job: Pick<Job, "applyUrl" | "title">;
  size?: "sm" | "default" | "icon";
  className?: string;
  /** When true, render icon-only. */
  iconOnly?: boolean;
  label?: string;
};

export function hasJobUrl(applyUrl: string | undefined | null): applyUrl is string {
  return Boolean(applyUrl && applyUrl !== "#");
}

/** Opens the job posting URL without marking the job as applied. */
export function JobUrlLink({
  job,
  className,
  iconOnly = false,
  label = "Job URL",
}: JobUrlLinkProps) {
  if (!hasJobUrl(job.applyUrl)) return null;

  return (
    <a
      href={job.applyUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open job posting for ${job.title}`}
      aria-label={`Open job posting for ${job.title}`}
      data-no-select
      className={cn(iconOnly ? "athens-icon-btn" : "athens-btn", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink size={16} aria-hidden="true" />
      {iconOnly ? null : label}
    </a>
  );
}

import React from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "../../../components/ui/button";
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
  size = "sm",
  className,
  iconOnly = false,
  label = "Job URL",
}: JobUrlLinkProps) {
  if (!hasJobUrl(job.applyUrl)) return null;

  return (
    <Button
      variant="outline"
      size={iconOnly ? "icon" : size}
      className={className}
      asChild
    >
      <a
        href={job.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open job posting for ${job.title}`}
        aria-label={`Open job posting for ${job.title}`}
        data-no-select
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="w-4 h-4" />
        {iconOnly ? null : label}
      </a>
    </Button>
  );
}

import React, { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { shortenSkillLabel } from "../../resumes/generator/history/skill-profile-utils";
import { ResumeRadarChart } from "../../resumes/components/analysis/ResumeRadarChart";
import type { JobSkillRadarData } from "../hooks/useJobSkillRadar";

type JobSkillMatchPanelProps = {
  data: JobSkillRadarData | null;
  loading: boolean;
  error: string | null;
  selectedResumeId?: string;
  onResumeChange: (resumeId: string) => void;
};

const MATCH_LABELS = {
  direct: "Direct",
  graph: "Graph",
  none: "Missing",
} as const;

const MATCH_VARIANTS = {
  direct: "success",
  graph: "violet",
  none: "subtle",
} as const;

const PROFILE_RESUME_ID = "__profile__";

function formatGraphPath(axis: JobSkillRadarData["axes"][number]): string | null {
  if (axis.matchType !== "graph" || !axis.pathSkills?.length) return null;
  const hops = axis.pathHops ?? 0;
  if (hops <= 0) return null;
  const via = axis.matchedVia ? ` → ${axis.matchedVia}` : "";
  const path = axis.pathSkills.join(" → ");
  const relHint = axis.pathRelTypes?.length
    ? ` (${axis.pathRelTypes.join(", ")})`
    : "";
  return `${path}${via}${relHint}`;
}

function MatchTable({ axes }: { axes: JobSkillRadarData["axes"] }) {
  if (!axes.length) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Skill</th>
            <th className="px-3 py-2 font-semibold text-right">Required</th>
            <th className="px-3 py-2 font-semibold text-right">You</th>
            <th className="px-3 py-2 font-semibold">Match</th>
            <th className="px-3 py-2 font-semibold">Via</th>
          </tr>
        </thead>
        <tbody>
          {axes.map((axis) => {
            const graphPath = formatGraphPath(axis);
            return (
            <tr key={axis.skill} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2 font-medium text-foreground">{axis.skill}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{axis.required}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{axis.user}</td>
              <td className="px-3 py-2">
                <Badge v={MATCH_VARIANTS[axis.matchType]}>{MATCH_LABELS[axis.matchType]}</Badge>
              </td>
              <td
                className="px-3 py-2 text-muted-foreground max-w-[200px] truncate"
                title={graphPath ?? axis.matchedVia ?? undefined}
              >
                {graphPath ?? axis.matchedVia ?? "—"}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResumeOptionLabel({
  label,
  recommended,
}: {
  label: string;
  recommended?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="truncate">{label}</span>
      {recommended ? (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-primary">
          Best fit
        </span>
      ) : null}
    </span>
  );
}

export function JobSkillMatchPanel({
  data,
  loading,
  error,
  selectedResumeId,
  onResumeChange,
}: JobSkillMatchPanelProps) {
  const chartData =
    data?.axes.map((axis) => ({
      dim: shortenSkillLabel(axis.skill, 16),
      required: axis.required,
      user: axis.user,
    })) ?? [];

  const activeResumeId = selectedResumeId || data?.resumeId || undefined;
  const recommendedId = data?.recommendedResumeId ?? null;

  const sortedResumes = useMemo(() => {
    if (!data?.availableResumes.length) return [];
    return [...data.availableResumes].sort((a, b) => {
      if (a.resumeId === recommendedId) return -1;
      if (b.resumeId === recommendedId) return 1;
      if (a.resumeId === PROFILE_RESUME_ID) return 1;
      if (b.resumeId === PROFILE_RESUME_ID) return -1;
      return a.label.localeCompare(b.label);
    });
  }, [data?.availableResumes, recommendedId]);

  const selectedLabel =
    sortedResumes.find((r) => r.resumeId === activeResumeId)?.label ??
    data?.resumeLabel ??
    "Select resume";

  if (loading && !data) {
    return (
      <div className="space-y-4 py-2">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-[280px] w-full rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
        {error}
      </p>
    );
  }

  if (!data?.availableResumes.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Sparkles className="size-8 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-foreground">No analyzed resumes yet</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Upload and analyze a resume in My Resumes to compare skills against this job.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 max-w-md">
          <label
            htmlFor="skill-match-resume-select"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground"
          >
            Compare resume
          </label>
          <Select
            modal={false}
            value={activeResumeId}
            onValueChange={onResumeChange}
          >
            <SelectTrigger
              id="skill-match-resume-select"
              className={cn(
                "h-10 w-full bg-card border-border shadow-sm",
                "hover:bg-secondary/50 transition-colors",
                loading && "opacity-70",
              )}
            >
              <SelectValue placeholder="Select a resume to compare">
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate font-medium">{selectedLabel}</span>
                  {activeResumeId === recommendedId ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-primary">
                      Best fit
                    </span>
                  ) : null}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[200] max-h-64">
              {sortedResumes.map((resume) => (
                <SelectItem key={resume.resumeId} value={resume.resumeId}>
                  <ResumeOptionLabel
                    label={resume.label}
                    recommended={resume.resumeId === recommendedId}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Defaults to the recommended resume for this job. Pick another to compare.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] shrink-0">
          {[
            { label: "Covered", value: data.summary.direct, className: "text-emerald-700 bg-emerald-50 border-emerald-200" },
            { label: "Missing", value: data.summary.missing, className: "text-muted-foreground bg-secondary border-border" },
          ].map((chip) => (
            <span
              key={chip.label}
              className={cn("rounded-md px-2 py-1 border font-semibold tabular-nums", chip.className)}
            >
              {chip.label} {chip.value}
            </span>
          ))}
        </div>
      </div>

      {data.skillAnalysisStatus && data.skillAnalysisStatus !== "analyzed" ? (
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          Skill graph enrichment is in progress for this job — scores will improve as relationships are added.
        </p>
      ) : null}

      <div className={cn("relative", loading && "opacity-60 pointer-events-none")}>
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Sparkles className="size-6 animate-pulse text-primary" />
          </div>
        ) : null}

        {chartData.length > 0 ? (
          <ResumeRadarChart
            data={chartData}
            series={[
              { key: "required", label: "Required", color: "#2dd4bf" },
              { key: "user", label: "You", color: "#6c5ce7" },
            ]}
            height={300}
            compact
          />
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No required skills listed for this job.
          </p>
        )}
      </div>

      <MatchTable axes={data.axes} />
    </div>
  );
}

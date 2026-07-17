import { AlertTriangle, CheckCircle2, Circle, FileText, Loader2 } from "lucide-react";
import type { ApplyProgress } from "@avalon/shared";
import { cn } from "../../../lib/utils";
import type { JobResume } from "../hooks/useAvalonRelay";

/**
 * Live, human-readable view of the auto-apply pipeline for the active job:
 * résumé → scan → analyze → upload → fill → submit → verify (+ self-healing).
 * Driven by the streamed ApplyProgress plus the résumé/analyze/apply flags so the
 * user can see exactly which step is running and where it stalls.
 */

type StageKey = "resume" | "scan" | "analyze" | "upload" | "fill" | "submit" | "verify";

const STAGES: { key: StageKey; label: string }[] = [
  { key: "resume", label: "Résumé" },
  { key: "scan", label: "Scan" },
  { key: "analyze", label: "Analyze" },
  { key: "upload", label: "Upload" },
  { key: "fill", label: "Fill" },
  { key: "submit", label: "Submit" },
  { key: "verify", label: "Verify" },
];

const STAGE_INDEX: Record<StageKey, number> = {
  resume: 0,
  scan: 1,
  analyze: 2,
  upload: 3,
  fill: 4,
  submit: 5,
  verify: 6,
};

/** Map the current live phase to the pipeline stage it belongs to. */
function activeStage(
  phase: ApplyProgress | null,
  analyzing: boolean,
  generatingResume?: boolean,
): StageKey {
  if (generatingResume) return "resume";
  if (analyzing) return "analyze";
  switch (phase?.phase) {
    case "navigating":
      return "scan";
    case "files":
      return "upload";
    case "fields":
      // The recovery loop reuses the 'fields' phase for self-healing.
      return phase.message?.toLowerCase().includes("self-healing") ? "verify" : "fill";
    case "submit-wait":
    case "verify-wait":
      return phase.phase === "verify-wait" ? "verify" : "submit";
    case "submitted":
      return "submit";
    case "done":
      return "verify";
    default:
      return "scan";
  }
}

type StageIconState = "done" | "active" | "idle";

function ApplyStageIcon({ state }: { state: StageIconState }) {
  return (
    <span className="inline-flex shrink-0" aria-hidden>
      {state === "done" ? (
        <CheckCircle2 className="w-3.5 h-3.5" />
      ) : state === "active" ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Circle className="w-3 h-3" />
      )}
    </span>
  );
}

export function ApplyStatusPanel({
  applying,
  analyzing,
  generatingResume,
  applyPhase,
  activeResume,
  jobTitle,
}: {
  applying: boolean;
  analyzing: boolean;
  generatingResume?: boolean;
  applyPhase: ApplyProgress | null;
  activeResume: JobResume | null;
  jobTitle?: string;
}) {
  if (!applying && !applyPhase && !generatingResume && !analyzing) return null;

  const current = activeStage(applyPhase, analyzing, generatingResume);
  const currentIdx = STAGE_INDEX[current];
  const isError = applyPhase?.phase === "error";
  const isDone = !applying && (applyPhase?.phase === "done" || applyPhase?.phase === "submitted");
  const errorMessage = isError ? applyPhase?.message : null;
  const verifyWaiting = applyPhase?.phase === "verify-wait";

  const total = applyPhase?.totalSteps ?? 0;
  const doneSteps = applyPhase?.appliedSteps ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((doneSteps / total) * 100)) : 0;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-sm overflow-hidden",
        isError ? "border-red-300/70" : "border-violet-300/60",
      )}
    >
      <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between gap-2 bg-gradient-to-r from-violet-500/5 to-transparent">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <span key={applying ? "busy" : isError ? "error" : "done"} className="inline-flex shrink-0" aria-hidden>
            {applying ? (
              <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
            ) : isError ? (
              <AlertTriangle className="w-4 h-4 text-red-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            )}
          </span>
          Apply status
          {jobTitle && <span className="text-xs font-normal text-muted-foreground truncate max-w-[200px]">· {jobTitle}</span>}
        </h2>
      </div>

      {/* Stage strip */}
      <div className="px-4 py-3 flex items-center gap-1 overflow-x-auto">
        {STAGES.map((stage, i) => {
          const done = i < currentIdx || isDone;
          const active = i === currentIdx && (applying || verifyWaiting) && !isDone;
          const iconState: StageIconState = done ? "done" : active ? "active" : "idle";
          return (
            <div key={stage.key} className="flex items-center shrink-0">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors",
                  done && "bg-emerald-500/10 text-emerald-700",
                  active && !isError && "bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30",
                  active && isError && "bg-red-500/15 text-red-700 ring-1 ring-red-500/30",
                  !done && !active && "text-muted-foreground",
                )}
              >
                <ApplyStageIcon key={iconState} state={iconState} />
                {stage.label}
              </div>
              {i < STAGES.length - 1 && <span className="w-3 h-px bg-border mx-0.5 shrink-0" aria-hidden />}
            </div>
          );
        })}
      </div>

      {/* Live message + progress */}
      <div className="px-4 pb-3 space-y-2">
        <div
          className={cn(
            "text-xs font-medium flex items-center gap-2",
            isError ? "text-red-700" : "text-foreground",
          )}
        >
          {(applyPhase?.phase === "submit-wait" || applyPhase?.phase === "verify-wait") &&
          applyPhase.secondsLeft != null ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                {applyPhase.secondsLeft}
              </span>
              {applyPhase.message}
            </span>
          ) : (
            <span>{errorMessage ?? applyPhase?.message ?? (applying ? "Working…" : "Idle")}</span>
          )}
        </div>

        {total > 0 && (
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", isError ? "bg-red-500" : "bg-violet-600")}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {/* Résumé sub-status */}
        {generatingResume && !activeResume && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-600 shrink-0" />
            <span>Generating tailored résumé PDF…</span>
          </div>
        )}
        {activeResume && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <FileText className="w-3.5 h-3.5 text-violet-600 shrink-0" />
            <span className="truncate">
              {activeResume.reused ? "Reusing" : "Generated"} résumé{" "}
              <span className="font-medium text-foreground">{activeResume.file.name}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

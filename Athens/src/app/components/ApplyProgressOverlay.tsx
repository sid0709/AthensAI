import type { ApplyProgress } from "@avalon/shared";
import { useApplyProgress } from "../hooks/useApplyProgress";

const PHASE_LABEL: Record<ApplyProgress["phase"], string> = {
  navigating: "Opening job tab",
  files: "Uploading files",
  fields: "Filling fields",
  "submit-wait": "Submitting",
  "verify-wait": "Verifying",
  submitted: "Submitted",
  done: "Done",
  error: "Error",
};

const PHASE_ACCENT: Record<ApplyProgress["phase"], string> = {
  navigating: "bg-blue-500",
  files: "bg-blue-500",
  fields: "bg-blue-500",
  "submit-wait": "bg-amber-500",
  "verify-wait": "bg-amber-500",
  submitted: "bg-emerald-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

/**
 * Floating panel that mirrors a live Avalon apply run — most importantly the
 * 5-second countdown before the auto-submit click. Renders nothing when idle.
 */
export function ApplyProgressOverlay() {
  const progress = useApplyProgress();
  if (!progress) return null;

  const countingDown =
    (progress.phase === "submit-wait" || progress.phase === "verify-wait") &&
    typeof progress.secondsLeft === "number";
  const pct =
    progress.totalSteps && progress.totalSteps > 0
      ? Math.round(((progress.appliedSteps ?? 0) / progress.totalSteps) * 100)
      : null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-border bg-card text-card-foreground shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${PHASE_ACCENT[progress.phase]}`} />
        <span className="text-sm font-medium">Auto-apply · {PHASE_LABEL[progress.phase]}</span>
      </div>

      <div className="px-4 py-4">
        {countingDown ? (
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-500 text-2xl font-semibold tabular-nums text-amber-600">
              {progress.secondsLeft}
            </div>
            <p className="text-sm text-muted-foreground">{progress.message}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{progress.message}</p>
        )}

        {pct !== null && !countingDown ? (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${PHASE_ACCENT[progress.phase]} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

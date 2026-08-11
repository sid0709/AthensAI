import { useEffect, useRef, useState } from "react";
import { Progress } from "../../../components/ui/progress";
import type { DeleteAccountProgress } from "../../../services/profileApi";

type Props = {
  progress: DeleteAccountProgress;
};

const PHASE_HINT: Record<string, string> = {
  verifying: "Checking credentials",
  preparing: "Preparing",
  firebase: "Firebase Storage",
  database: "Database",
  account: "Account",
  done: "Complete",
};

/** Ease the visible bar toward server percent for smoother motion. */
function useSmoothedPercent(target: number): number {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    const goal = Math.max(0, Math.min(100, target));
    let raf = 0;
    let alive = true;
    let value = shownRef.current;

    const tick = () => {
      if (!alive) return;
      value += (goal - value) * 0.22;
      if (Math.abs(goal - value) < 0.35) {
        value = goal;
        shownRef.current = value;
        setShown(value);
        return;
      }
      shownRef.current = value;
      setShown(value);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [target]);

  return shown;
}

export function DeleteAccountProgressPanel({ progress }: Props) {
  const percent = useSmoothedPercent(Number(progress.percent) || 0);
  const hasCounts = progress.total > 0;
  const countLabel = hasCounts
    ? `${progress.removed.toLocaleString()} of ${progress.total.toLocaleString()} removed`
    : progress.phase === "done"
      ? "All set"
      : "Working…";
  const phaseHint = PHASE_HINT[progress.phase] ?? "Deleting";

  return (
    <div
      className="space-y-4 py-1"
      aria-live="polite"
      aria-busy={progress.phase !== "done"}
    >
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <p
            key={progress.message}
            className="text-sm font-medium text-foreground leading-snug animate-in fade-in duration-300"
          >
            {progress.message}
          </p>
          <span className="shrink-0 text-xs font-mono tabular-nums text-muted-foreground pt-0.5">
            {Math.round(percent)}%
          </span>
        </div>
        <Progress
          value={percent}
          className="h-2.5 bg-destructive/15 [&>[data-slot=progress-indicator]]:bg-destructive [&>[data-slot=progress-indicator]]:duration-300 [&>[data-slot=progress-indicator]]:ease-out"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span
            className={
              progress.phase === "done"
                ? "size-1.5 shrink-0 rounded-full bg-destructive"
                : "size-1.5 shrink-0 rounded-full bg-destructive animate-pulse"
            }
          />
          <span className="truncate">{phaseHint}</span>
        </span>
        <span className="shrink-0 font-mono tabular-nums transition-all duration-300">
          {countLabel}
        </span>
      </div>
    </div>
  );
}

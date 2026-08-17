import { useEffect, useRef, useState } from "react";
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
      className="athens-progress athens-progress--danger py-1"
      aria-live="polite"
      aria-busy={progress.phase !== "done"}
    >
      <div className="athens-progress__meta">
        <p key={progress.message} className="athens-card-title">
          {progress.message}
        </p>
        <span className="tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div className="athens-progress__track">
        <div className="athens-progress__bar" style={{ width: `${percent}%` }} />
      </div>
      <div className="athens-progress__meta">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span
            className={progress.phase === "done" ? "athens-settings__pulse is-done" : "athens-settings__pulse"}
          />
          <span className="truncate">{phaseHint}</span>
        </span>
        <span className="shrink-0 tabular-nums">{countLabel}</span>
      </div>
    </div>
  );
}

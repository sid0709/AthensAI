import { useEffect, useRef } from "react";
import { Loader2, Square } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { PATHS } from "../config/routes";
import { useBackgroundTasks } from "../context/BackgroundTaskContext";
import { skillExtractionSessionFromTask } from "../features/job-search/lib/skillExtractionState";

/**
 * App-shell monitor for Job Search skill extraction. Keeps wait/toast and a
 * floating progress tray alive across route changes so Analyze/Extract does
 * not appear to reset when leaving /jobs.
 */
export function BackgroundAiProgressOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const { latestTask, cancelTask, waitForTask } = useBackgroundTasks();
  const task = latestTask("skill_extraction");
  const session = skillExtractionSessionFromTask(task);
  const onJobSearch = location.pathname.startsWith(PATHS.jobs);
  const toastedTerminal = useRef<string | null>(null);

  useEffect(() => {
    if (!task || !["queued", "running", "cancelling"].includes(task.status)) return;
    const controller = new AbortController();
    void waitForTask(task.id, controller.signal).then((terminal) => {
      if (toastedTerminal.current === terminal.id + terminal.status) return;
      toastedTerminal.current = terminal.id + terminal.status;
      const result = skillExtractionSessionFromTask(terminal);
      if (terminal.status === "failed") {
        toast.error("Skill extraction failed", {
          description: terminal.error || "The extraction worker stopped unexpectedly.",
        });
      } else if (terminal.status === "cancelled") {
        toast.info("Skill extraction stopped");
      } else if ((result?.failed ?? 0) > 0) {
        toast.warning("Skill extraction finished with errors", {
          description: `${result?.processed ?? 0} processed · ${result?.failed ?? 0} failed.`,
        });
      } else {
        toast.success("Skill extraction completed", {
          description: `${result?.extracted ?? result?.processed ?? 0} job(s) updated.`,
        });
      }
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Unable to monitor skill extraction");
      }
    });
    return () => controller.abort();
  }, [task?.id, task?.status, waitForTask]);

  if (!session?.running || onJobSearch) return null;

  const queued = session.status === "queued";
  const total = session.total ?? null;
  const processed = session.processed ?? 0;
  const pct = !queued && total ? Math.min(100, Math.round((processed / total) * 100)) : null;
  const label = session.status === "stopping"
    ? "Stopping skill extraction…"
    : queued
      ? "Skill extraction queued…"
      : processed === 0
        ? "Analyzing first batch…"
        : "Extracting job skills…";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-border bg-card text-card-foreground shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Loader2 className="size-3.5 animate-spin text-violet-600" />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => navigate(PATHS.jobs)}
        >
          Open
        </Button>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Continues in the background</span>
          <span className="font-mono tabular-nums">
            {total != null ? `${processed}/${total}` : `${processed} done`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={pct ?? undefined}>
          <div
            className={`h-full bg-violet-600 transition-all ${pct == null ? "w-1/3 animate-pulse" : ""}`}
            style={pct == null ? undefined : { width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={session.status === "stopping" || !task}
            onClick={() => {
              if (task) void cancelTask(task.id);
            }}
          >
            <Square className="size-3.5" />
            Stop
          </Button>
        </div>
      </div>
    </div>
  );
}

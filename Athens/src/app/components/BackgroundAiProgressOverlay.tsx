import { useEffect, useRef, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { PATHS } from "../config/routes";
import { useApplier } from "@/context/applier-context";
import {
  fetchSkillExtractStatus,
  stopSkillExtract,
  type SkillExtractSession,
} from "../api/jobSkillExtract";
import { useBackgroundTasks } from "../context/BackgroundTaskContext";
import { skillExtractionSessionFromTask } from "../features/job-search/lib/skillExtractionState";

function profileIdOf(applier: { _id?: unknown } | null | undefined): string | undefined {
  const id = applier?._id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/**
 * App-shell monitor for Job Search AI Analyze. Keeps a floating progress tray
 * alive across route changes so Analyze does not appear to reset when leaving /jobs.
 */
export function BackgroundAiProgressOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const { applier } = useApplier();
  const { latestTask, waitForTask } = useBackgroundTasks();
  const task = latestTask("skill_extraction");
  const taskSession = skillExtractionSessionFromTask(task);
  const [apiSession, setApiSession] = useState<SkillExtractSession | null>(null);
  const onJobSearch = location.pathname.startsWith(PATHS.jobs);
  const toastedTerminal = useRef<string | null>(null);
  const wasRunning = useRef(false);

  const session = taskSession || apiSession;
  const running = Boolean(session?.running);

  useEffect(() => {
    if (onJobSearch || !applier?.name) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchSkillExtractStatus(applier.name);
        if (cancelled) return;
        setApiSession(next);
        if (wasRunning.current && !next.running) {
          const key = `${next.sessionId || "done"}:${next.processed}:${next.failed}`;
          if (toastedTerminal.current !== key) {
            toastedTerminal.current = key;
            if ((next.failed ?? 0) > 0) {
              toast.warning("AI analyze finished with errors", {
                description: `${next.processed ?? 0} processed · ${next.failed ?? 0} failed.`,
              });
            } else if ((next.processed ?? 0) > 0) {
              toast.success("AI analyze completed", {
                description: `${next.extracted ?? next.processed ?? 0} job(s) updated.`,
              });
            }
          }
        }
        wasRunning.current = Boolean(next.running);
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [applier?.name, onJobSearch]);

  useEffect(() => {
    if (!task || !["queued", "running", "cancelling"].includes(task.status)) return;
    const controller = new AbortController();
    void waitForTask(task.id, controller.signal).then((terminal) => {
      if (toastedTerminal.current === terminal.id + terminal.status) return;
      toastedTerminal.current = terminal.id + terminal.status;
      const result = skillExtractionSessionFromTask(terminal);
      if (terminal.status === "failed") {
        toast.error("AI analyze failed", {
          description: terminal.error || "The analyze worker stopped unexpectedly.",
        });
      } else if (terminal.status === "cancelled") {
        toast.info("AI analyze stopped");
      } else if ((result?.failed ?? 0) > 0) {
        toast.warning("AI analyze finished with errors", {
          description: `${result?.processed ?? 0} processed · ${result?.failed ?? 0} failed.`,
        });
      } else {
        toast.success("AI analyze completed", {
          description: `${result?.extracted ?? result?.processed ?? 0} job(s) updated.`,
        });
      }
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Unable to monitor AI analyze");
      }
    });
    return () => controller.abort();
  }, [task?.id, task?.status, waitForTask]);

  if (!running || onJobSearch) return null;

  const queued = session?.status === "queued";
  const total = session?.total ?? null;
  const processed = session?.processed ?? 0;
  const pct = !queued && total ? Math.min(100, Math.round((processed / total) * 100)) : null;
  const label = session?.status === "stopping"
    ? "Stopping AI analyze…"
    : queued
      ? "AI analyze queued…"
      : processed === 0
        ? "Analyzing first batch…"
        : "Analyzing jobs…";

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
            disabled={session?.status === "stopping"}
            onClick={() => {
              void stopSkillExtract(applier?.name, profileIdOf(applier)).then(() => {
                toast.info("AI analyze stopped");
                setApiSession((prev) => (prev ? { ...prev, running: false, status: "idle" } : prev));
              }).catch((error) => {
                toast.error(error instanceof Error ? error.message : "Failed to stop AI analyze");
              });
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

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  fetchSkillExtractStatus,
  startSkillExtract,
  stopSkillExtract,
  type SkillExtractSession,
} from "@/app/api/jobSkillExtract";

const POLL_MS = 1500;
const IDLE_POLL_MS = 5000;

export function useJobSkillExtraction() {
  const { applier } = useApplier();
  const [session, setSession] = useState<SkillExtractSession>({ running: false, status: "idle" });
  const [pending, setPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await fetchSkillExtractStatus(applier?.name);
      setSession(status);
      setPending(status.pending ?? null);
      return status;
    } catch {
      return null;
    }
  }, [applier?.name]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((intervalMs = POLL_MS) => {
    stopPolling();
    pollRef.current = setInterval(() => void refresh(), intervalMs);
  }, [refresh, stopPolling]);

  useEffect(() => {
    void refresh();
    return () => stopPolling();
  }, [refresh, stopPolling]);

  useEffect(() => {
    startPolling(session.running ? POLL_MS : IDLE_POLL_MS);
    return () => stopPolling();
  }, [session.running, startPolling, stopPolling]);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      const result = await startSkillExtract(applier?.name);
      if (result.started) {
        toast.success("Skill extraction started", {
          description: result.pending != null || pending != null
            ? `${result.pending ?? pending} job(s) queued.`
            : "Processing jobs that do not have extracted skills.",
        });
      } else {
        toast.info(result.message || "No jobs pending extraction.");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start extraction");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, pending, refresh]);

  const stop = useCallback(async () => {
    setLoading(true);
    try {
      await stopSkillExtract();
      toast.info("Stopping extraction…");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop extraction");
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return { session, pending, loading, isRunning: session.running, start, stop, refresh };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  fetchTitleScanStatus,
  startTitleScan,
  stopTitleScan,
  type TitleScanSession,
} from "@/app/api/jobTitleScan";

const POLL_MS = 1200;

export function useJobTitleScan({ enabled = true }: { enabled?: boolean } = {}) {
  const { applier } = useApplier();
  const [session, setSession] = useState<TitleScanSession>({ running: false, status: "idle" });
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasRunning = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !applier?.name) return null;
    try {
      const status = await fetchTitleScanStatus(applier.name);
      setSession(status);
      setPending(status.pending ?? 0);
      return status;
    } catch {
      return null;
    }
  }, [applier?.name, enabled]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => void refresh(), POLL_MS);
  }, [refresh, stopPolling]);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      return;
    }
    void refresh();
    return () => stopPolling();
  }, [enabled, refresh, stopPolling]);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      return;
    }
    if (session.running) {
      wasRunning.current = true;
      startPolling();
    } else {
      stopPolling();
      if (wasRunning.current && (session.status === "completed" || session.status === "cancelled")) {
        wasRunning.current = false;
        void refresh();
      }
    }
  }, [enabled, session.running, session.status, startPolling, stopPolling, refresh]);

  const start = useCallback(async () => {
    if (!enabled) {
      toast.error("Beta workspace required.");
      return;
    }
    setLoading(true);
    try {
      const result = await startTitleScan(applier?.name);
      if (result.started) {
        toast.success("Title analysis started", {
          description: `${result.pending ?? pending} New job(s) queued.`,
        });
      } else {
        toast.info(result.message || "No New jobs pending title analysis.");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start title analysis");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, enabled, pending, refresh]);

  const stop = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      await stopTitleScan(applier?.name);
      toast.info("Stopping title analysis…");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop title analysis");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, enabled, refresh]);

  return { session, pending, loading, isRunning: session.running, start, stop, refresh };
}

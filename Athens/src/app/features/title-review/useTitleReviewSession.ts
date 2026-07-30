import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  fetchTitleReviewStatus,
  startTitleReview,
  stopTitleReview,
  type TitleReviewSession,
} from "@/app/api/jobTitleReview";

const POLL_MS = 1000;

export function useTitleReviewSession({ enabled = true }: { enabled?: boolean } = {}) {
  const { applier } = useApplier();
  const [session, setSession] = useState<TitleReviewSession>({ running: false, status: "idle" });
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !applier?.name) return null;
    try {
      const next = await fetchTitleReviewStatus(applier.name);
      setSession(next);
      return next;
    } catch {
      return null;
    }
  }, [applier?.name, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (enabled && session.running) {
      timer.current = setInterval(() => void refresh(), POLL_MS);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [enabled, refresh, session.running]);

  const start = useCallback(async () => {
    if (!applier?.name) return null;
    setLoading(true);
    try {
      const result = await startTitleReview(applier.name);
      if (result.started) toast.success("Title review started", { description: `${result.pending ?? 0} title(s) queued.` });
      else toast.info(result.message || "No titles are waiting for review.");
      await refresh();
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start title review");
      return null;
    } finally {
      setLoading(false);
    }
  }, [applier?.name, refresh]);

  const stop = useCallback(async () => {
    if (!applier?.name) return;
    setLoading(true);
    try {
      await stopTitleReview(applier.name);
      toast.info("Stopping title review…");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop title review");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, refresh]);

  return { session, loading, refresh, start, stop };
}


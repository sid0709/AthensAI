import { useCallback, useEffect, useRef, useState } from "react";
import { useApplier } from "@/context/applier-context";
import {
  fetchBidResults,
  fetchBidResultStats,
  patchBidResultStatus,
} from "../../../api/bidResults";
import type { BidResult, BidResultStatus, BidResultStats } from "../types";
import { canChangeStatus, isEditableStatus } from "../types";

export function useBidResults() {
  const { applier, applierReady } = useApplier();
  const [results, setResults] = useState<BidResult[]>([]);
  const [stats, setStats] = useState<BidResultStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** In-flight status PATCH ids — block stale focus/visibility reloads from overwriting. */
  const pendingStatusIds = useRef(new Set<string>());
  const resultsRef = useRef<BidResult[]>([]);
  resultsRef.current = results;

  const reload = useCallback(async () => {
    const name = applier?.name?.trim();
    if (!name) {
      setResults([]);
      setStats(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rows, nextStats] = await Promise.all([
        fetchBidResults(name),
        fetchBidResultStats(name).catch(() => null),
      ]);
      // Keep optimistic / PATCH-merged rows for in-flight mutations.
      if (pendingStatusIds.current.size > 0) {
        const pending = pendingStatusIds.current;
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const id of pending) {
          const local = resultsRef.current.find((r) => r.id === id);
          if (local) byId.set(id, local);
        }
        setResults(Array.from(byId.values()));
      } else {
        setResults(rows);
      }
      setStats(nextStats);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Failed to load bid results");
    } finally {
      setLoading(false);
    }
  }, [applier?.name]);

  useEffect(() => {
    if (!applierReady) return;
    void reload();
  }, [applierReady, reload]);

  useEffect(() => {
    const onFocus = () => {
      if (pendingStatusIds.current.size > 0) return;
      void reload();
    };
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (pendingStatusIds.current.size > 0) return;
      void reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reload]);

  const setStatus = useCallback(
    async (
      id: string,
      next: BidResultStatus,
      options?: { rejectReason?: string | null },
    ) => {
      if (!isEditableStatus(next) && !(next === "rejected")) return;
      const name = applier?.name?.trim();
      if (!name) return;

      const current = resultsRef.current.find((r) => r.id === id);
      if (current && !canChangeStatus(current.status, next)) return;
      if (next !== "submitted" && next !== "reviewed" && next !== "rejected") return;

      const prev = resultsRef.current;
      pendingStatusIds.current.add(id);
      setResults((list) =>
        list.map((r) =>
          r.id === id
            ? {
                ...r,
                status: next,
                rejectReason:
                  next === "rejected" ? options?.rejectReason ?? r.rejectReason : null,
              }
            : r,
        ),
      );
      try {
        const updated = await patchBidResultStatus(id, name, next, options);
        if (updated) {
          setResults((list) =>
            list.map((r) => {
              if (r.id !== id) return r;
              // Prefer server row, but keep stable folder day if PATCH omitted queue date.
              return {
                ...updated,
                dayKey: updated.dayKey || r.dayKey,
                pooledAt: updated.pooledAt || r.pooledAt,
              };
            }),
          );
        }
        void fetchBidResultStats(name)
          .then(setStats)
          .catch(() => {});
      } catch (err) {
        setResults(prev);
        setError(err instanceof Error ? err.message : "Failed to update status");
      } finally {
        pendingStatusIds.current.delete(id);
      }
    },
    [applier?.name],
  );

  return {
    results,
    stats,
    loading,
    error,
    reload,
    setStatus,
    applierName: applier?.name ?? null,
  };
}

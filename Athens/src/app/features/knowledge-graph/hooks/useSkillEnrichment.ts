import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchEnrichmentStatus,
  fetchPendingSkills,
  fetchSkillSubgraph,
  startEnrichment,
  stopEnrichment,
  type EnrichmentSession,
  type PendingSkill,
  type QueueStats,
  type SkillAnalysisUsage,
} from "@/app/api/skillGraph";
import { buildUpdatedSubgraphData } from "../lib/graphAdapter";
import type { EnrichmentUpdateSnapshot } from "../components/EnrichmentUpdateGraph";
import type { GraphRenderData } from "../lib/graphAdapter";

const SUBGRAPH_DEBOUNCE_MS = 1500;
const SUBGRAPH_MIN_SKILLS = 1;

async function loadUpdateGraph(skillIds: string[]): Promise<GraphRenderData | null> {
  const ids = [...new Set(skillIds.filter(Boolean))].slice(0, 80);
  if (ids.length < SUBGRAPH_MIN_SKILLS) return null;
  const subgraph = await fetchSkillSubgraph(ids, true);
  if (!subgraph.nodes.length) return null;
  return buildUpdatedSubgraphData(
    subgraph.nodes.map((n) => ({ id: n.id, label: n.label, category: n.category })),
    subgraph.edges.map((e) => ({ from: e.from, to: e.to, type: e.type, weight: e.weight })),
  );
}

export function useSkillEnrichment(onProgress?: () => void) {
  const [session, setSession] = useState<EnrichmentSession>({ running: false, status: "idle" });
  const [stats, setStats] = useState<QueueStats>({ pending: 0, processing: 0, done: 0, failed: 0 });
  const [pending, setPending] = useState<PendingSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateSnapshot, setUpdateSnapshot] = useState<EnrichmentUpdateSnapshot | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevProcessed = useRef(0);
  const subgraphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSkillIds = useRef<string[]>([]);

  const scheduleSubgraphRefresh = useCallback((skillIds: string[], meta: {
    label: string;
    nodesUpdated: number;
    relationshipsUpdated: number;
    loadingGraph?: boolean;
  }) => {
    lastSkillIds.current = skillIds;
    if (subgraphTimer.current) clearTimeout(subgraphTimer.current);

    setUpdateSnapshot((prev) => ({
      label: meta.label,
      nodesUpdated: meta.nodesUpdated,
      relationshipsUpdated: meta.relationshipsUpdated,
      graphData: meta.loadingGraph ? prev?.graphData ?? null : prev?.graphData ?? null,
      loadingGraph: true,
    }));

    subgraphTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const graphData = await loadUpdateGraph(skillIds);
          setUpdateSnapshot({
            label: meta.label,
            nodesUpdated: meta.nodesUpdated,
            relationshipsUpdated: meta.relationshipsUpdated,
            graphData,
            loadingGraph: false,
          });
        } catch {
          setUpdateSnapshot({
            label: meta.label,
            nodesUpdated: meta.nodesUpdated,
            relationshipsUpdated: meta.relationshipsUpdated,
            graphData: null,
            loadingGraph: false,
          });
        }
      })();
    }, SUBGRAPH_DEBOUNCE_MS);
  }, []);

  const refreshPending = useCallback(async () => {
    const data = await fetchPendingSkills();
    setPending(data.pending);
    setStats(data.stats);
    return data;
  }, []);

  const refreshStatus = useCallback(async () => {
    const data = await fetchEnrichmentStatus();
    const s = data.session;
    setSession(s);
    setStats(data.stats);

    const nodesUpdated = s.nodesUpdated ?? 0;
    const relationshipsUpdated = s.relationshipsUpdated ?? 0;
    const skillIds = s.updatedSkillIds ?? [];

    if (s.processed != null && s.processed > prevProcessed.current) {
      prevProcessed.current = s.processed;
      onProgress?.();
    }

    if (skillIds.length > 0 && (s.running || s.status === "completed" || s.status === "cancelled")) {
      scheduleSubgraphRefresh(skillIds, {
        label: s.running ? "Analyzing pending skills…" : "Last analyze session",
        nodesUpdated,
        relationshipsUpdated,
      });
    }

    if (!s.running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      await refreshPending();
    }

    return data;
  }, [onProgress, refreshPending, scheduleSubgraphRefresh]);

  useEffect(() => {
    void refreshPending().catch(() => undefined);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (subgraphTimer.current) clearTimeout(subgraphTimer.current);
    };
  }, [refreshPending]);

  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void refreshStatus().catch(() => undefined);
    }, 2000);
  }, [refreshStatus]);

  const analyze = useCallback(
    async (options: { applierName?: string; mode?: "fast" | "smart" } = {}) => {
      setLoading(true);
      setError(null);
      try {
        prevProcessed.current = 0;
        lastSkillIds.current = [];
        setUpdateSnapshot({
          label: "Analyzing pending skills…",
          nodesUpdated: 0,
          relationshipsUpdated: 0,
          graphData: null,
          loadingGraph: false,
        });
        await startEnrichment(options);
        startPoll();
        await refreshStatus();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analyze failed");
      } finally {
        setLoading(false);
      }
    },
    [refreshStatus, startPoll],
  );

  const stop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await stopEnrichment();
      await refreshStatus();
      await refreshPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setLoading(false);
    }
  }, [refreshPending, refreshStatus]);

  const showManualUpdate = useCallback(
    (meta: {
      label: string;
      nodesUpdated: number;
      relationshipsUpdated: number;
      updatedSkillIds: string[];
    }) => {
      scheduleSubgraphRefresh(meta.updatedSkillIds, meta);
    },
    [scheduleSubgraphRefresh],
  );

  const usage = (session.usage ?? null) as SkillAnalysisUsage | null;

  return {
    session,
    stats,
    pending,
    loading,
    error,
    usage,
    updateSnapshot,
    analyze,
    stop,
    refreshPending,
    refreshStatus,
    showManualUpdate,
    isRunning: session.running || loading,
  };
}

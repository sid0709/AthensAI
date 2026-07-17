import { useCallback, useEffect, useMemo, useState } from "react";
import { useApplier } from "@/context/applier-context";
import { fetchGenerationDetail, fetchGenerationHistory, type HistoryQuery } from "../../../services/resumeApi";
import type { HistoryRunDetail, HistoryRunSummary } from "../../../types/resume";
import { sectionsToDocument } from "../lib/sectionsToDocument";
import type { GeneratorIdentity } from "../../../types/resume";

export type HistoryFilters = {
  search: string;
  status: string;
  model: string;
  provider: string;
  templateId: string;
  sort: "newest" | "oldest";
};

const DEFAULT_FILTERS: HistoryFilters = {
  search: "",
  status: "completed",
  model: "all",
  provider: "all",
  templateId: "all",
  sort: "newest",
};

export function useResumeHistory() {
  const { applier, applierReady } = useApplier();
  const [runs, setRuns] = useState<HistoryRunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<HistoryRunDetail | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [facets, setFacets] = useState<{ models?: string[]; providers?: string[]; templates?: string[] }>({});

  const refresh = useCallback(async () => {
    if (!applier?.name) {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const query: HistoryQuery = {
        applierName: applier.name,
        limit: 100,
        offset: 0,
        sort: filters.sort === "oldest" ? "oldest" : "newest",
      };
      if (filters.search) query.search = filters.search;
      if (filters.status !== "all") query.status = filters.status;
      if (filters.model !== "all") query.model = filters.model;
      if (filters.provider !== "all") query.provider = filters.provider;
      if (filters.templateId !== "all") query.templateId = filters.templateId;

      const data = await fetchGenerationHistory(query);
      setRuns(data.runs);
      setTotal(data.total);
      setFacets(data.facets ?? {});
      if (!selectedId && data.runs.length) setSelectedId(data.runs[0].id);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [applier?.name, filters, selectedId]);

  useEffect(() => {
    if (!applierReady) return;
    void refresh();
  }, [applierReady, refresh]);

  useEffect(() => {
    if (!selectedId || !applier?.name) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    void fetchGenerationDetail(selectedId, applier.name)
      .then((detail) => {
        if (!cancelled) setSelectedDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, applier?.name]);

  const stats = useMemo(() => {
    const completed = runs.filter((r) => r.status === "completed").length;
    const totalTokens = runs.reduce((s, r) => s + (r.tokens ?? 0), 0);
    const totalSpend = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    return { completed, totalTokens, totalSpend, inView: runs.length };
  }, [runs]);

  const selected = selectedDetail ?? runs.find((r) => r.id === selectedId) ?? null;

  const models = facets.models ?? [...new Set(runs.map((r) => r.model))];
  const providers = facets.providers ?? [...new Set(runs.map((r) => r.provider))];
  const templates = facets.templates ?? [...new Set(runs.map((r) => r.templateId).filter(Boolean) as string[])];

  const detailDocument = useMemo(() => {
    if (!selectedDetail?.sections || !selectedDetail.identity) return null;
    return sectionsToDocument(
      selectedDetail.sections as Parameters<typeof sectionsToDocument>[0],
      selectedDetail.identity as GeneratorIdentity,
    );
  }, [selectedDetail]);

  return {
    loading,
    runs,
    total,
    filtered: runs,
    selected,
    selectedDetail,
    detailDocument,
    filters,
    setFilters,
    setSelectedId,
    stats,
    models,
    providers,
    templates,
    refresh,
  };
}

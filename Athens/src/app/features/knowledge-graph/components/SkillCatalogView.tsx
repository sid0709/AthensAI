import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Network, Sparkles, Square, Wand2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { SearchField } from "../../../components/shared/SearchField";
import { PaginationBar } from "../../../components/shared/PaginationBar";
import { Badge } from "../../../components/ui";
import { cn, mono } from "../../../lib/utils";
import {
  enhanceSkillRelations,
  fetchMatchingSkillIds,
  fetchSkillList,
  fetchSkillSubgraph,
  formatEnrichmentCost,
  type GraphSkill,
} from "@/app/api/skillGraph";
import { useSkillEnrichment } from "../hooks/useSkillEnrichment";
import { buildUpdatedSubgraphData } from "../lib/graphAdapter";
import { EnrichmentUpdateGraph, type EnrichmentUpdateSnapshot } from "./EnrichmentUpdateGraph";

type EnrichmentState = ReturnType<typeof useSkillEnrichment>;

export type SkillCatalogViewProps = {
  title: string;
  description?: string;
  applierName?: string;
  enrichment?: EnrichmentState;
  showEnrichment?: boolean;
  className?: string;
};

const PAGE_SIZE = 30;

export function SkillCatalogView({
  title,
  description,
  applierName,
  enrichment: enrichmentProp,
  showEnrichment = false,
  className,
}: SkillCatalogViewProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [skills, setSkills] = useState<GraphSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceResult, setEnhanceResult] = useState<string | null>(null);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<EnrichmentUpdateSnapshot | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSkillList({ q: debouncedSearch, page, limit: PAGE_SIZE });
      setSkills(data.skills);
      setTotal(data.pagination.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
      setSkills([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  const enrichmentInternal = useSkillEnrichment(() => {
    void loadSkills();
  });
  const enrichment = showEnrichment ? enrichmentInternal : enrichmentProp;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    setPreviewSnapshot(null);
  }, [selectedIds]);

  const pageIds = useMemo(() => skills.map((s) => s.id), [skills]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const toggleSkill = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setEnhanceResult(null);
  };

  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
    setEnhanceResult(null);
  };

  const selectAllMatching = async () => {
    setSelectAllLoading(true);
    setEnhanceResult(null);
    try {
      const { ids } = await fetchMatchingSkillIds(debouncedSearch, 200);
      setSelectedIds(new Set(ids));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select all");
    } finally {
      setSelectAllLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setEnhanceResult(null);
    setPreviewSnapshot(null);
  };

  const handlePreview = async () => {
    if (selectedIds.size < 2) return;
    setPreviewLoading(true);
    setError(null);
    const ids = [...selectedIds].slice(0, 80);
    setPreviewSnapshot({
      label: "Current relations",
      isPreview: true,
      nodesUpdated: ids.length,
      relationshipsUpdated: 0,
      graphData: null,
      loadingGraph: true,
    });
    try {
      const subgraph = await fetchSkillSubgraph(ids, true);
      const graphData = subgraph.nodes.length
        ? buildUpdatedSubgraphData(
            subgraph.nodes.map((n) => ({ id: n.id, label: n.label, category: n.category })),
            subgraph.edges.map((e) => ({ from: e.from, to: e.to, type: e.type, weight: e.weight })),
          )
        : null;
      setPreviewSnapshot({
        label: "Current relations",
        isPreview: true,
        nodesUpdated: ids.length,
        relationshipsUpdated: subgraph.edges.length,
        graphData,
        loadingGraph: false,
      });
    } catch (e) {
      setPreviewSnapshot(null);
      setError(e instanceof Error ? e.message : "Failed to load relation preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleEnhance = async () => {
    if (selectedIds.size < 2) return;
    setEnhancing(true);
    setEnhanceResult(null);
    setPreviewSnapshot(null);
    setError(null);
    try {
      const result = await enhanceSkillRelations({
        skillIds: [...selectedIds],
        applierName,
      });
      const cost = formatEnrichmentCost(result.usage);
      setEnhanceResult(
        `Updated ${result.nodesUpdated} skill${result.nodesUpdated === 1 ? "" : "s"} · ${result.relationshipsUpdated} relation${result.relationshipsUpdated === 1 ? "" : "s"} added${cost ? ` · ${cost}` : ""}`,
      );
      enrichment?.showManualUpdate({
        label: "Enhance relations",
        nodesUpdated: result.nodesUpdated,
        relationshipsUpdated: result.relationshipsUpdated,
        updatedSkillIds: result.updatedSkillIds,
      });
      void loadSkills();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enhance relations failed");
    } finally {
      setEnhancing(false);
    }
  };

  const isRunning = enrichment?.isRunning ?? false;
  const enrichLoading = enrichment?.loading ?? false;
  const costLabel = enrichment ? formatEnrichmentCost(enrichment.usage) : null;
  const pending = enrichment?.stats.pending ?? 0;
  const graphSnapshot = enrichment?.updateSnapshot ?? previewSnapshot;
  const graphSnapshotLoading = previewLoading || Boolean(graphSnapshot?.loadingGraph);

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      <div className="shrink-0 border-b border-border px-6 py-4 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {title}
            </h2>
            {description ? (
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{description}</p>
            ) : null}
          </div>

          {showEnrichment && enrichment ? (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <Button variant="destructive" size="sm" onClick={() => void enrichment.stop()} disabled={enrichLoading}>
                    <Square className="w-4 h-4" />
                    Stop
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={isRunning || enrichLoading || pending === 0}
                  onClick={() => void enrichment.analyze({ applierName, mode: "smart" })}
                >
                  {isRunning || enrichLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Analyze pending ({pending})
                </Button>
              </div>
              {isRunning && enrichment.session.processed != null ? (
                <p className={cn("text-[10px] text-muted-foreground", mono)}>
                  {enrichment.session.processed} processed ·{" "}
                  {enrichment.session.nodesUpdated ?? 0} nodes ·{" "}
                  {enrichment.session.relationshipsUpdated ?? 0} relations ·{" "}
                  {enrichment.session.remaining ?? "?"} left
                  {costLabel ? ` · AI ${costLabel}` : ""}
                </p>
              ) : enrichment.error ? (
                <p className="text-xs text-destructive">{enrichment.error}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search skills (e.g. react, postgres)…"
            className="w-full max-w-md"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={selectAllLoading || total === 0}
            onClick={() => void selectAllMatching()}
          >
            {selectAllLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Select all matching ({total.toLocaleString()})
          </Button>
          {selectedIds.size > 0 ? (
            <>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear ({selectedIds.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedIds.size < 2 || previewLoading || enhancing}
                onClick={() => void handlePreview()}
              >
                {previewLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Network className="w-4 h-4" />
                )}
                Preview current status
              </Button>
              <Button
                size="sm"
                disabled={selectedIds.size < 2 || enhancing}
                onClick={() => void handleEnhance()}
              >
                {enhancing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                Enhance relations ({selectedIds.size})
              </Button>
            </>
          ) : null}
        </div>

        {enhanceResult ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">{enhanceResult}</p>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {graphSnapshot ? (
          <EnrichmentUpdateGraph
            snapshot={
              graphSnapshotLoading
                ? { ...graphSnapshot, loadingGraph: true }
                : graphSnapshot
            }
          />
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto subtle-scroll">
        {loading && !skills.length ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading skills…
          </div>
        ) : !skills.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-2 px-8">
            <p className="text-sm font-semibold text-foreground">No skills found</p>
            <p className="text-xs text-muted-foreground">
              {debouncedSearch
                ? `No results for "${debouncedSearch}". Try a different search term.`
                : "The knowledge graph is empty. Analyze jobs or resumes to populate skills."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b border-border z-10">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={togglePage}
                    aria-label="Select all on page"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Skill
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground hidden md:table-cell">
                  Type
                </th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr
                  key={skill.id}
                  className={cn(
                    "border-b border-border/50 hover:bg-secondary/30 cursor-pointer transition-colors",
                    selectedIds.has(skill.id) && "bg-primary/5",
                  )}
                  onClick={() => toggleSkill(skill.id)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(skill.id)}
                      onCheckedChange={() => toggleSkill(skill.id)}
                      aria-label={`Select ${skill.label}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-foreground">{skill.label}</span>
                    <span className={cn("block text-[10px] text-muted-foreground mt-0.5", mono)}>
                      {skill.id}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {skill.category || "concept"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">{skill.skillType || "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4">
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          align="between"
          detailed
        />
      </div>
    </div>
  );
}

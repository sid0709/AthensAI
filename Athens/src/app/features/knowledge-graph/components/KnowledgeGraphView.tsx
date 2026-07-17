import { useMemo, useState } from "react";
import { Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { SkillRelationType } from "../../../types/knowledgeGraph";
import { formatEnrichmentCost } from "@/app/api/skillGraph";
import { cn, mono } from "../../../lib/utils";
import type { UseSkillGraphResult } from "../hooks/useSkillGraph";
import type { useSkillEnrichment } from "../hooks/useSkillEnrichment";
import { SkillGraphCanvas } from "./SkillGraphCanvas";
import { GraphToolbar } from "./GraphToolbar";
import { SkillInspectorPanel } from "./SkillInspectorPanel";
import { SkillStrengthPanel } from "./SkillStrengthPanel";
import { filterGraphToResumeSeeds, appendLocalSkillNodes, buildDirectSkillGraphData, type GraphRenderData } from "../lib/graphAdapter";

const ALL_RELATIONS: SkillRelationType[] = [
  "PREREQUISITE_OF",
  "BUILDS_ON",
  "USED_WITH",
  "RELATED_TO",
  "PART_OF",
];

type EnrichmentState = ReturnType<typeof useSkillEnrichment>;

export type KnowledgeGraphViewProps = {
  title: string;
  description?: string;
  graph: UseSkillGraphResult;
  enrichment?: EnrichmentState;
  showEnrichment?: boolean;
  showProfileToggle?: boolean;
  showStrengthPanel?: boolean;
  applierName?: string;
  /** When true, default to resume seed skills only (no world-graph neighbors). */
  resumeSeedFocus?: boolean;
  /** When false, hide the global enrichment queue (not the user's resume skills). */
  showPendingQueue?: boolean;
  className?: string;
  toolbarClassName?: string;
};

export function KnowledgeGraphView({
  title,
  description,
  graph,
  enrichment,
  showEnrichment = false,
  showProfileToggle = true,
  showStrengthPanel = false,
  resumeSeedFocus = false,
  applierName,
  showPendingQueue = true,
  className,
  toolbarClassName,
}: KnowledgeGraphViewProps) {
  const {
    profiles,
    activeResumeIds,
    toggleResume,
    setAllResumes,
    alpha,
    setAlpha,
    graphData,
    result,
    loading,
    error,
    totalNodes,
    truncated,
    searchNodes,
    worldGraph,
    skillStrengthList,
  } = graph;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibleRelations, setVisibleRelations] = useState<Set<SkillRelationType>>(
    () => new Set(ALL_RELATIONS),
  );
  const [showWorldContext, setShowWorldContext] = useState(false);

  const activeProfileEdges = useMemo(() => {
    if (!resumeSeedFocus || showWorldContext) return [];
    for (const p of profiles) {
      if (activeResumeIds.has(p.id)) return p.graph.edges ?? [];
    }
    return [];
  }, [profiles, activeResumeIds, resumeSeedFocus, showWorldContext]);

  const canvasData: GraphRenderData = useMemo(() => {
    if (resumeSeedFocus && !showWorldContext && skillStrengthList.length) {
      return buildDirectSkillGraphData(skillStrengthList, worldGraph, activeProfileEdges);
    }
    let data = graphData;
    if (resumeSeedFocus && !showWorldContext) {
      data = filterGraphToResumeSeeds(graphData);
      data = appendLocalSkillNodes(data, skillStrengthList);
    }
    return data;
  }, [graphData, resumeSeedFocus, showWorldContext, skillStrengthList, worldGraph, activeProfileEdges]);

  const toggleRelation = (type: SkillRelationType) =>
    setVisibleRelations((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const selectedNode = useMemo(
    () => canvasData.nodes.find((n) => n.id === selectedId) ?? null,
    [canvasData.nodes, selectedId],
  );

  const displayStats = useMemo(() => {
    const usingDirectSkills = resumeSeedFocus && !showWorldContext && skillStrengthList.length > 0;
    const seeds = canvasData.nodes.filter((n) => n.isSeed).length;
    const activated = usingDirectSkills
      ? canvasData.nodes.length
      : canvasData.nodes.filter((n) => n.isSeed || n.activation > 0.04).length;
    return {
      pending: enrichment?.stats.pending ?? 0,
      universe: usingDirectSkills ? canvasData.nodes.length : (worldGraph?.nodes.length ?? 0),
      totalWorld: totalNodes,
      seeds,
      activated,
    };
  }, [canvasData.nodes, enrichment?.stats.pending, totalNodes, worldGraph?.nodes.length, resumeSeedFocus, showWorldContext, skillStrengthList.length]);

  const costLabel = enrichment ? formatEnrichmentCost(enrichment.usage) : null;
  const isRunning = enrichment?.isRunning ?? false;
  const enrichLoading = enrichment?.loading ?? false;

  const toolbarSearchNodes = useMemo(() => {
    if (resumeSeedFocus && !showWorldContext && canvasData.nodes.length) {
      return canvasData.nodes.map((n) => ({ id: n.id, label: n.label, category: n.category }));
    }
    return searchNodes;
  }, [resumeSeedFocus, showWorldContext, canvasData.nodes, searchNodes]);

  return (
    <div className={cn("relative h-full w-full bg-background", className)}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 60%)",
        }}
      />

      <div className="absolute inset-0 z-0">
        {loading && !worldGraph?.nodes.length ? (
          <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading world skill graph…
          </div>
        ) : error && !worldGraph?.nodes.length ? (
          <div className="flex items-center justify-center h-full text-destructive text-sm px-8 text-center">
            {error}
          </div>
        ) : (
          <SkillGraphCanvas
            data={canvasData}
            selectedId={selectedId}
            onSelect={setSelectedId}
            visibleRelations={visibleRelations}
            neo4jStyle
          />
        )}
      </div>

      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-4 pointer-events-none z-10">
        <div className="pointer-events-auto">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{description}</p>
          ) : null}
          {resumeSeedFocus ? (
            <button
              type="button"
              onClick={() => setShowWorldContext((v) => !v)}
              className="mt-2 text-xs font-semibold text-primary hover:underline pointer-events-auto"
            >
              {showWorldContext
                ? "Show resume skills only"
                : "Show world graph context (includes related skills)"}
            </button>
          ) : null}
          {truncated && showWorldContext ? (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
              Showing {displayStats.universe} of {displayStats.totalWorld} world skills.
            </p>
          ) : null}
        </div>
        {showEnrichment && enrichment ? (
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="flex flex-wrap gap-2 justify-end">
              <StatChip label="Pending" value={displayStats.pending} />
              <StatChip label="Universe" value={displayStats.universe} />
              <StatChip label="Activated" value={displayStats.activated} />
              <StatChip label="Core" value={displayStats.seeds} />
            </div>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <Button variant="destructive" size="sm" onClick={() => void enrichment.stop()} disabled={enrichLoading}>
                  <Square className="w-4 h-4" />
                  Stop
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={isRunning || enrichLoading || displayStats.pending === 0}
                onClick={() => void enrichment.analyze({ applierName, mode: "fast" })}
              >
                {isRunning || enrichLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Analyze pending ({displayStats.pending})
              </Button>
            </div>
            {isRunning && enrichment.session.processed != null ? (
              <p className={cn("text-[10px] text-muted-foreground", mono)}>
                {enrichment.session.processed} done · {enrichment.session.remaining ?? "?"} left
                {costLabel ? ` · AI ${costLabel}` : ""}
              </p>
            ) : costLabel && enrichment.session.status === "completed" ? (
              <p className={cn("text-[10px] text-muted-foreground", mono)}>AI {costLabel}</p>
            ) : null}
            {enrichment.error ? <p className="text-xs text-destructive">{enrichment.error}</p> : null}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "absolute top-24 left-4 w-72 max-h-[calc(100%-7rem)] overflow-y-auto subtle-scroll pointer-events-none z-10",
          toolbarClassName,
        )}
      >
        <GraphToolbar
          profiles={profiles}
          activeResumeIds={activeResumeIds}
          onToggleResume={toggleResume}
          onSetAll={setAllResumes}
          alpha={alpha}
          onAlphaChange={setAlpha}
          visibleRelations={visibleRelations}
          onToggleRelation={toggleRelation}
          onSearchSelect={setSelectedId}
          search={search}
          onSearchChange={setSearch}
          searchNodes={toolbarSearchNodes}
          pendingSkills={showPendingQueue ? (enrichment?.pending ?? []) : []}
          matchScoreHint={showProfileToggle}
          showProfiles={showProfileToggle}
          hideActivationControls={resumeSeedFocus && !showWorldContext}
          profileSkillFocus={resumeSeedFocus && !showWorldContext}
        />
      </div>

      {showStrengthPanel && skillStrengthList.length > 0 ? (
        <div className="absolute top-24 right-4 w-56 max-h-[calc(100%-7rem)] overflow-y-auto subtle-scroll pointer-events-auto z-10">
          <SkillStrengthPanel
            skills={skillStrengthList}
            onSelect={(id) => setSelectedId(id)}
            selectedId={selectedId}
          />
        </div>
      ) : null}

      <SkillInspectorPanel
        node={selectedNode}
        result={result}
        profiles={profiles}
        edges={worldGraph?.edges ?? []}
        nodeLabels={Object.fromEntries(canvasData.nodes.map((n) => [n.id, n.label]))}
        nodeCategories={Object.fromEntries(canvasData.nodes.map((n) => [n.id, n.category]))}
        onClose={() => setSelectedId(null)}
        onSelectNeighbor={setSelectedId}
      />
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-sm text-center min-w-16">
      <div className="text-lg font-bold text-foreground leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

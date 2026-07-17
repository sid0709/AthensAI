import { useMemo } from "react";
import { Network } from "lucide-react";
import { SkillGraphCanvas } from "./SkillGraphCanvas";
import type { GraphRenderData } from "../lib/graphAdapter";
import { cn, mono } from "../../../lib/utils";

export type EnrichmentUpdateSnapshot = {
  label: string;
  nodesUpdated: number;
  relationshipsUpdated: number;
  graphData: GraphRenderData | null;
  loadingGraph?: boolean;
  /** Read-only preview of existing relations (before AI enhance). */
  isPreview?: boolean;
};

type EnrichmentUpdateGraphProps = {
  snapshot: EnrichmentUpdateSnapshot | null;
  className?: string;
};

export function EnrichmentUpdateGraph({ snapshot, className }: EnrichmentUpdateGraphProps) {
  const hasGraph = Boolean(snapshot?.graphData?.nodes.length);

  const summary = useMemo(() => {
    if (!snapshot) return null;
    if (snapshot.isPreview) {
      const parts = [
        `${snapshot.nodesUpdated} skill${snapshot.nodesUpdated === 1 ? "" : "s"} selected`,
      ];
      if (hasGraph) {
        parts.push(
          `${snapshot.graphData!.links.length} existing relation${snapshot.graphData!.links.length === 1 ? "" : "s"}`,
        );
        parts.push(
          `${snapshot.graphData!.nodes.length} skill${snapshot.graphData!.nodes.length === 1 ? "" : "s"} in view`,
        );
      } else {
        parts.push("no relations yet");
      }
      return parts.join(" · ");
    }
    const parts = [
      `${snapshot.nodesUpdated} node${snapshot.nodesUpdated === 1 ? "" : "s"} updated`,
      `${snapshot.relationshipsUpdated} relation${snapshot.relationshipsUpdated === 1 ? "" : "s"} added`,
    ];
    if (hasGraph) {
      parts.push(
        `${snapshot.graphData!.nodes.length} skills · ${snapshot.graphData!.links.length} edges in view`,
      );
    }
    return parts.join(" · ");
  }, [snapshot, hasGraph]);

  if (!snapshot) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-primary/25 bg-primary/5 overflow-hidden",
        className,
      )}
    >
      <div className="px-4 py-2.5 border-b border-primary/15 flex items-center gap-2 flex-wrap">
        <Network className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground">{snapshot.label}</span>
        {summary ? (
          <span className={cn("text-[10px] text-muted-foreground", mono)}>{summary}</span>
        ) : null}
      </div>

      {snapshot.loadingGraph ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          Loading update graph…
        </div>
      ) : hasGraph ? (
        <div className="h-[220px] bg-background/60">
          <SkillGraphCanvas
            data={snapshot.graphData!}
            selectedId={null}
            onSelect={() => {}}
            neo4jStyle
            compactNodes
          />
        </div>
      ) : (
        <div className="px-4 py-6 text-xs text-muted-foreground text-center">
          {snapshot.isPreview
            ? "No relations exist yet between the selected skills. Use Enhance relations to generate connections with AI."
            : snapshot.nodesUpdated > 0
              ? "Skills were updated but no internal relations exist yet among them."
              : "No graph changes to display."}
        </div>
      )}
    </div>
  );
}

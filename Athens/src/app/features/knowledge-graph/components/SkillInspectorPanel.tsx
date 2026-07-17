import { useMemo } from "react";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import type { ActivationResult, SkillEdge, SkillCategory } from "../../../types/knowledgeGraph";
import { strongestNeighbors } from "../lib/activation";
import { CATEGORY_HUE, CATEGORY_LABEL, type GraphRenderNode } from "../lib/graphAdapter";
import type { ProfileOption } from "../hooks/useSkillGraph";

type SkillInspectorPanelProps = {
  node: GraphRenderNode | null;
  result: ActivationResult;
  profiles: ProfileOption[];
  edges: SkillEdge[];
  nodeLabels: Record<string, string>;
  nodeCategories: Record<string, SkillCategory>;
  onClose: () => void;
  onSelectNeighbor: (id: string) => void;
};

function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SkillInspectorPanel({
  node,
  result,
  profiles,
  edges,
  nodeLabels,
  nodeCategories,
  onClose,
  onSelectNeighbor,
}: SkillInspectorPanelProps) {
  const neighbors = useMemo(() => {
    if (!node) return [];
    return strongestNeighbors(node.id, edges, result.edgeWeights, 8);
  }, [node, edges, result.edgeWeights]);

  const contributors = useMemo(() => {
    if (!node) return [];
    const ids = result.contributors[node.id] ?? [];
    return ids
      .map((id) => profiles.find((p) => p.id === id)?.name ?? id)
      .filter(Boolean);
  }, [node, result.contributors, profiles]);

  return (
    <SlidePanel open={!!node} onOpenChange={(open) => !open && onClose()} width="sm">
      {node && (
        <>
          <SlidePanelHeader title="Skill inspector" onClose={onClose} />
          <div className="p-4 space-y-5 overflow-y-auto subtle-scroll flex-1">
            <div className="flex items-center gap-3">
              <span
                className="w-9 h-9 rounded-xl flex-shrink-0"
                style={{
                  background: `radial-gradient(circle at 30% 30%, hsl(${CATEGORY_HUE[node.category]}, 85%, 62%), hsl(${CATEGORY_HUE[node.category]}, 70%, 42%))`,
                }}
              />
              <div className="min-w-0">
                <h3 className="text-base font-bold text-foreground truncate">{node.label}</h3>
                <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[node.category]}</span>
              </div>
            </div>

            {node.blurb && <p className="text-sm text-muted-foreground">{node.blurb}</p>}

            <div className="space-y-3">
              <Meter
                label="Activation"
                value={node.activation}
                hint="How strongly this skill lights up given the active profile."
              />
              <Meter
                label="Direct evidence"
                value={node.evidence}
                hint={
                  node.isSeed
                    ? "Present directly on an active resume."
                    : "Activated indirectly through neighboring skills."
                }
              />
            </div>

            {contributors.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Evidence from
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {contributors.map((name) => (
                    <span
                      key={name}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-foreground border border-primary/30"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Strongest connections
              </span>
              <div className="space-y-1.5">
                {neighbors.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onSelectNeighbor(n.id)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary transition-colors text-left"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: `hsl(${CATEGORY_HUE[nodeCategories[n.id] ?? "concept"]}, 70%, 55%)`,
                      }}
                    />
                    <span className="text-sm text-foreground flex-1 truncate">
                      {nodeLabels[n.id] ?? n.id}
                    </span>
                    <span className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${Math.round(n.weight * 100)}%` }}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </SlidePanel>
  );
}

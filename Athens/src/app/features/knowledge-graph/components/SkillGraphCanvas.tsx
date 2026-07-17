import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Maximize2, Minus, Plus } from "lucide-react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Button } from "../../../components/ui/button";
import {
  CATEGORY_HUE,
  nodeColor,
  type GraphRenderData,
  type GraphRenderLink,
  type GraphRenderNode,
} from "../lib/graphAdapter";
import type { SkillCategory } from "../../../types/knowledgeGraph";

type SkillGraphCanvasProps = {
  data: GraphRenderData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Relation types to show; when undefined all are shown. */
  visibleRelations?: Set<string>;
  /** Neo4j-style: visible edges, category-colored nodes, strong activation contrast. */
  neo4jStyle?: boolean;
  /** Smaller nodes so edges stay visible in compact preview panels. */
  compactNodes?: boolean;
};

type Palette = {
  text: string;
  linkBase: [number, number, number];
  particle: string;
};

const PALETTES: Record<"dark" | "light", Palette> = {
  dark: { text: "#eeeef6", linkBase: [255, 255, 255], particle: "#9b87f7" },
  light: { text: "#0d0d14", linkBase: [80, 80, 110], particle: "#6c5ce7" },
};

export function SkillGraphCanvas({
  data,
  selectedId,
  onSelect,
  visibleRelations,
  neo4jStyle = false,
  compactNodes = false,
}: SkillGraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraphMethods<GraphRenderNode, GraphRenderLink> | undefined>(undefined);
  const posRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const fittedRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { resolvedTheme } = useTheme();
  const palette = PALETTES[resolvedTheme === "light" ? "light" : "dark"];

  // Measure container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Persist node positions across recomputes so toggling profiles ripples the
  // activation glow without re-shuffling the whole layout.
  const graphData = useMemo(() => {
    const cache = posRef.current;
    const nodes = data.nodes.map((n) => {
      const prev = cache.get(n.id);
      return prev ? { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy } : { ...n };
    });
    return { nodes, links: data.links.map((l) => ({ ...l })) };
  }, [data]);

  useEffect(() => {
    fittedRef.current = false;
  }, [data.nodes.length, data.links.length]);

  // Re-render for activation pulse on highly activated nodes.
  useEffect(() => {
    if (!neo4jStyle) return;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      if (frame % 2 === 0) fgRef.current?.refresh?.();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [neo4jStyle, graphData.nodes.length]);

  const fitView = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    fg.zoomToFit(400, 60);
    fittedRef.current = true;
  }, [graphData.nodes.length]);

  const zoomBy = useCallback((factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const next = Math.min(8, Math.max(0.15, fg.zoom() * factor));
    fg.zoom(next, 300);
  }, []);
  // Configure forces once the instance exists.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(neo4jStyle ? -80 : -120).distanceMax(600);
    const link = fg.d3Force("link");
    if (link) {
      link.distance((l: GraphRenderLink) => (neo4jStyle ? 28 : 35) + (1 - l.weight) * 70).strength(
        (l: GraphRenderLink) => (neo4jStyle ? 0.15 : 0.08) + l.weight * 0.35,
      );
    }
    // Keep isolated nodes (no edges) bounded near the center instead of drifting
    // off to infinity, which otherwise breaks zoom-to-fit and node positions.
    // Custom, dependency-free centering force applied each simulation tick.
    let centerNodes: Array<{ x?: number; y?: number; vx?: number; vy?: number }> = [];
    const centeringForce = (alpha: number) => {
      const k = 0.05 * alpha;
      for (const n of centerNodes) {
        if (typeof n.x === "number" && Number.isFinite(n.x) && typeof n.vx === "number") {
          n.vx -= n.x * k;
        }
        if (typeof n.y === "number" && Number.isFinite(n.y) && typeof n.vy === "number") {
          n.vy -= n.y * k;
        }
      }
    };
    centeringForce.initialize = (nodes: typeof centerNodes) => {
      centerNodes = nodes;
    };
    fg.d3Force("center-pull", centeringForce as unknown as never);
    fg.d3ReheatSimulation?.();
  }, [size.width, size.height, graphData.nodes.length, neo4jStyle]);

  // Pan to a node when it becomes selected (e.g. via search).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !selectedId) return;
    const node = graphData.nodes.find((n) => n.id === selectedId);
    if (node && typeof node.x === "number" && typeof node.y === "number") {
      fg.centerAt(node.x, node.y, 600);
      fg.zoom(2.2, 600);
    }
  }, [selectedId, graphData.nodes]);

  const capturePositions = useCallback(() => {
    for (const n of graphData.nodes) {
      if (typeof n.x === "number" && typeof n.y === "number") {
        posRef.current.set(n.id, { x: n.x, y: n.y, vx: n.vx ?? 0, vy: n.vy ?? 0 });
      }
    }
  }, [graphData]);

  const handleEngineStop = useCallback(() => {
    capturePositions();
    if (!fittedRef.current && graphData.nodes.length > 0) {
      fgRef.current?.zoomToFit(400, 60);
      fittedRef.current = true;
    }
  }, [capturePositions, graphData.nodes.length]);

  // Neighbor set of the active (selected or hovered) node for highlighting.
  const focusId = hoverId ?? selectedId;
  const neighborIds = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const l of data.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as GraphRenderNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as GraphRenderNode).id;
      if (s === focusId) set.add(t);
      if (t === focusId) set.add(s);
    }
    return set;
  }, [focusId, data.links]);

  const drawNode = useCallback(
    (node: GraphRenderNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      // d3-force can briefly emit NaN/Infinity for isolated nodes; skip until finite.
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const x = node.x as number;
      const y = node.y as number;
      const a = Number.isFinite(node.activation) ? node.activation : 0;
      const isSeed = Boolean(node.isSeed);
      const isActivated = isSeed || a > 0.04;
      const isHighlyActivated = isSeed || a > 0.12;
      const nodeScale = compactNodes ? 0.62 : 1;

      const focusDim = neighborIds ? !neighborIds.has(node.id) : false;
      const alpha = focusDim
        ? 0.12
        : isHighlyActivated
          ? 1
          : isActivated
            ? 0.55 + a * 0.45
            : neo4jStyle
              ? 0.28
              : 0.18;

      const strength = typeof node.strength === "number" ? node.strength : isSeed ? 8 : 0;
      const baseR =
        (isHighlyActivated
          ? 6 + strength * 0.55 + a * 10
          : isActivated
            ? 3.5 + a * 8
            : neo4jStyle
              ? 3.2
              : 2 + a * 4) * nodeScale;

      const hue = nodeColor(node.category, Math.max(a, isSeed ? 0.85 : 0.15));
      ctx.globalAlpha = alpha;

      // Outer halo — much stronger for seeds / activated nodes.
      if (isHighlyActivated) {
        const pulse = 1 + Math.sin(Date.now() / 500 + x * 0.1) * 0.15;
        const glowR = baseR * (2.8 + a * 2.2) * pulse;
        const grad = ctx.createRadialGradient(x, y, baseR * 0.2, x, y, glowR);
        grad.addColorStop(0, hueToGlow(node.category, 0.75));
        grad.addColorStop(0.45, hueToGlow(node.category, 0.35));
        grad.addColorStop(1, hueToGlow(node.category, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fill();
      } else if (isActivated) {
        const glowR = baseR * 2.2;
        ctx.fillStyle = hueToGlow(node.category, 0.22 + a * 0.35);
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Core node (Neo4j-style solid circle).
      ctx.beginPath();
      ctx.arc(x, y, baseR, 0, Math.PI * 2);
      ctx.fillStyle = hue;
      ctx.fill();

      if (neo4jStyle) {
        ctx.lineWidth = Math.max(0.8, 1.4 / globalScale);
        ctx.strokeStyle = isHighlyActivated
          ? "rgba(255,255,255,0.95)"
          : isActivated
            ? "rgba(255,255,255,0.55)"
            : "rgba(255,255,255,0.18)";
        ctx.stroke();
      }

      // Seed / selection ring.
      if (isSeed || node.id === selectedId) {
        ctx.lineWidth = node.id === selectedId ? 2.5 / globalScale : 1.8 / globalScale;
        ctx.strokeStyle =
          node.id === selectedId ? palette.text : hueToGlow(node.category, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, baseR + 2 / globalScale, 0, Math.PI * 2);
        ctx.stroke();
      }

      const showLabel =
        node.id === focusId ||
        isHighlyActivated ||
        (neo4jStyle && isActivated && globalScale > 0.55) ||
        globalScale > 0.75 ||
        a > 0.08;
      if (showLabel && globalScale > 0.32) {
        const fontSize = Math.max(9, (10 + (isHighlyActivated ? 4 : 0) + a * 3) / globalScale);
        ctx.font = `${isHighlyActivated || isSeed ? "600 " : ""}${fontSize}px Figtree, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isHighlyActivated ? palette.text : palette.text;
        ctx.globalAlpha = focusDim ? 0.2 : isHighlyActivated ? 1 : 0.75;
        const labelY = y + baseR + 3 / globalScale;
        ctx.fillText(node.label, x, labelY);
        if (isSeed && typeof node.strength === "number") {
          const scoreSize = Math.max(8, fontSize * 0.85);
          ctx.font = `600 ${scoreSize}px ui-monospace, monospace`;
          ctx.fillStyle = hue;
          ctx.fillText(node.strength.toFixed(1), x, labelY + fontSize + 1 / globalScale);
        }
      }

      ctx.globalAlpha = 1;
    },
    [neighborIds, selectedId, focusId, palette.text, neo4jStyle, compactNodes],
  );

  const drawPointerArea = useCallback(
    (node: GraphRenderNode, color: string, ctx: CanvasRenderingContext2D) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const x = node.x as number;
      const y = node.y as number;
      const a = Number.isFinite(node.activation) ? node.activation : 0;
      const r = (6 + a * 9) * (compactNodes ? 0.62 : 1);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    },
    [compactNodes],
  );

  const drawLink = useCallback(
    (link: GraphRenderLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const s = link.source as GraphRenderNode;
      const t = link.target as GraphRenderNode;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(t.x) || !Number.isFinite(t.y)) {
        return;
      }
      const energy = link.energy ?? 0;
      const [r, g, b] = palette.linkBase;

      const focusDim =
        neighborIds &&
        (!neighborIds.has(s.id) || !neighborIds.has(t.id));

      let opacity: number;
      let width: number;
      if (neo4jStyle) {
        opacity = focusDim ? 0.06 : energy > 0.08 ? 0.35 + energy * 0.45 : 0.18;
        width = Math.max(0.6, (0.8 + link.weight * 1.8 + energy * 2.5) / globalScale);
      } else {
        opacity = focusDim ? 0.04 : 0.12 + link.weight * 0.2 + energy * 0.25;
        width = Math.max(0.5, (0.5 + link.weight * 2.5) / globalScale);
      }

      ctx.beginPath();
      ctx.moveTo(s.x as number, s.y as number);
      ctx.lineTo(t.x as number, t.y as number);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      ctx.lineWidth = width;
      ctx.stroke();
    },
    [palette.linkBase, neighborIds, neo4jStyle],
  );

  const linkColor = useCallback(
    (link: GraphRenderLink) => {
      const [r, g, b] = palette.linkBase;
      let op = neo4jStyle
        ? 0.18 + link.weight * 0.15 + link.energy * 0.2
        : 0.12 + link.weight * 0.2 + link.energy * 0.25;
      if (neighborIds) {
        const s = typeof link.source === "string" ? link.source : (link.source as GraphRenderNode).id;
        const t = typeof link.target === "string" ? link.target : (link.target as GraphRenderNode).id;
        const active = neighborIds.has(s) && neighborIds.has(t);
        op = active ? Math.min(0.95, 0.35 + link.energy * 0.6) : neo4jStyle ? 0.06 : 0.04;
      }
      return `rgba(${r}, ${g}, ${b}, ${op})`;
    },
    [palette.linkBase, neighborIds, neo4jStyle],
  );

  if (size.width === 0) {
    return <div ref={wrapRef} className="w-full h-full min-h-[400px]" />;
  }

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-0 touch-none">
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={4}
        minZoom={0.08}
        maxZoom={12}
        enableZoomInteraction
        enablePanInteraction
        enableNodeDrag
        nodeLabel={(n: GraphRenderNode) => {
          const strength =
            typeof n.strength === "number" ? ` · ${n.strength.toFixed(1)}/10` : "";
          return `${n.label} — ${Math.round(n.activation * 100)}%${strength}`;
        }}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={drawPointerArea}
        linkCanvasObject={neo4jStyle ? drawLink : undefined}
        linkCanvasObjectMode={neo4jStyle ? () => "replace" : undefined}
        linkColor={linkColor}
        linkVisibility={(l: GraphRenderLink) =>
          !visibleRelations || visibleRelations.has(l.type)
        }
        linkWidth={(l: GraphRenderLink) =>
          neo4jStyle ? 0 : 0.5 + l.weight * 2.5
        }
        linkDirectionalParticles={(l: GraphRenderLink) => (l.energy > 0.35 ? 2 : 0)}
        linkDirectionalParticleWidth={(l: GraphRenderLink) => 1 + l.energy * 2.5}
        linkDirectionalParticleSpeed={(l: GraphRenderLink) => 0.002 + l.energy * 0.01}
        linkDirectionalParticleColor={() => palette.particle}
        onNodeClick={(n: GraphRenderNode) => onSelect(n.id === selectedId ? null : n.id)}
        onNodeHover={(n: GraphRenderNode | null) => setHoverId(n ? n.id : null)}
        onBackgroundClick={() => onSelect(null)}
        onNodeDragEnd={capturePositions}
        onEngineStop={handleEngineStop}
        cooldownTicks={150}
        warmupTicks={30}
        d3VelocityDecay={0.35}
      />

      <div className="absolute bottom-4 right-4 flex flex-col gap-2 pointer-events-auto z-20">
        <div className="flex flex-col gap-1 bg-card/95 border border-border rounded-lg shadow-sm p-1">
          <Button type="button" variant="ghost" size="icon" className="size-8" title="Zoom in" onClick={() => zoomBy(1.35)}>
            <Plus className="w-4 h-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" title="Zoom out" onClick={() => zoomBy(1 / 1.35)}>
            <Minus className="w-4 h-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" title="Fit graph to view" onClick={fitView}>
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground bg-card/90 border border-border rounded-md px-2 py-1 max-w-[140px] leading-snug">
          Scroll · pinch to zoom. Drag background to pan. Drag nodes to reposition. Click to inspect.
        </p>
      </div>
    </div>
  );
}

/** Glow color helper at an explicit opacity, using shared category hues. */
function hueToGlow(category: SkillCategory, opacity: number): string {
  return `hsla(${CATEGORY_HUE[category]}, 90%, 65%, ${opacity})`;
}

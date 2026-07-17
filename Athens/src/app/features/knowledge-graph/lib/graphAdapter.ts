import type {
  ActivationResult,
  SkillCategory,
  SkillGraph,
} from "../../../types/knowledgeGraph";
import { edgeKey } from "./activation";

/** Render node consumed by react-force-graph. Mutated in place by d3-force. */
export interface GraphRenderNode {
  id: string;
  label: string;
  category: SkillCategory;
  blurb?: string;
  /** Activation in [0, 1] — drives glow, size, pulse. */
  activation: number;
  /** Raw direct evidence in [0, 1]. */
  evidence: number;
  /** True if the skill is directly present on an active resume. */
  isSeed: boolean;
  /** Resume strength score 0–10 when available. */
  strength?: number;
  /** d3-force populates these. */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphRenderLink {
  source: string;
  target: string;
  type: string;
  /** Effective weight in [0, 1] — drives thickness/opacity/particles. */
  weight: number;
  /** Combined activation of both endpoints — drives flow animation. */
  energy: number;
}

export interface GraphRenderData {
  nodes: GraphRenderNode[];
  links: GraphRenderLink[];
}

/** Brand-aligned hue per skill category (HSL hue degrees). */
export const CATEGORY_HUE: Record<SkillCategory, number> = {
  language: 256, // violet (brand)
  frontend: 190, // cyan/teal
  backend: 152, // green
  cloud: 28, // amber/orange
  database: 330, // pink
  devops: 210, // blue
  data: 280, // purple
  mobile: 95, // lime
  concept: 230, // indigo (taxonomy anchors)
};

export const CATEGORY_LABEL: Record<SkillCategory, string> = {
  language: "Language",
  frontend: "Frontend",
  backend: "Backend",
  cloud: "Cloud",
  database: "Database",
  devops: "DevOps",
  data: "Data",
  mobile: "Mobile",
  concept: "Concept",
};

/**
 * HSL color string for a node, where activation modulates lightness/saturation
 * so highly-activated skills appear vivid and "lit" while dormant ones are dim.
 */
export function nodeColor(category: SkillCategory, activation: number): string {
  const hue = CATEGORY_HUE[category];
  const sat = 35 + activation * 55; // 35% -> 90%
  const light = 32 + activation * 30; // 32% -> 62%
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/** Glow/halo color (brighter, semi-transparent) for the activation aura. */
export function nodeGlow(category: SkillCategory, activation: number): string {
  const hue = CATEGORY_HUE[category];
  return `hsla(${hue}, 90%, 65%, ${0.15 + activation * 0.55})`;
}

export function buildGraphData(
  graph: SkillGraph,
  result: ActivationResult,
  strengthByNodeId?: Record<string, number>,
): GraphRenderData {
  const nodes: GraphRenderNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    category: n.category,
    blurb: n.blurb,
    activation: result.activation[n.id] ?? 0,
    evidence: result.evidence[n.id] ?? 0,
    isSeed: (result.evidence[n.id] ?? 0) > 0,
    strength: strengthByNodeId?.[n.id],
  }));

  const links: GraphRenderLink[] = graph.edges.map((e) => {
    const weight = result.edgeWeights[edgeKey(e.from, e.to)] ?? e.weight;
    const energy =
      ((result.activation[e.from] ?? 0) + (result.activation[e.to] ?? 0)) / 2;
    return {
      source: e.from,
      target: e.to,
      type: e.type,
      weight,
      energy,
    };
  });

  return { nodes, links };
}

/** Render only analyzed resume/profile skills (not the full world graph). */
export function buildDirectSkillGraphData(
  skills: { id: string; label: string; strength: number }[],
  worldGraph: SkillGraph | null,
  edges: { fromId: string; toId: string; type: string; weight: number }[] = [],
): GraphRenderData {
  const worldById = new Map((worldGraph?.nodes ?? []).map((n) => [n.id, n]));
  const skillIds = new Set(skills.map((s) => s.id));

  const nodes: GraphRenderNode[] = skills.map((s) => {
    const world = worldById.get(s.id);
    const activation = Math.max(0.25, Math.min(1, s.strength / 10));
    return {
      id: s.id,
      label: world?.label ?? s.label,
      category: world?.category ?? "concept",
      blurb: world?.blurb,
      activation,
      evidence: activation,
      isSeed: true,
      strength: s.strength,
    };
  });

  const links: GraphRenderLink[] = [];
  for (const e of edges) {
    if (!skillIds.has(e.fromId) || !skillIds.has(e.toId)) continue;
    const energy =
      ((nodes.find((n) => n.id === e.fromId)?.activation ?? 0)
        + (nodes.find((n) => n.id === e.toId)?.activation ?? 0)) / 2;
    links.push({
      source: e.fromId,
      target: e.toId,
      type: e.type,
      weight: e.weight,
      energy,
    });
  }

  return { nodes, links };
}

/** Keep only resume seed skills and edges between them (no world-graph propagation). */
export function filterGraphToResumeSeeds(data: GraphRenderData): GraphRenderData {
  const seedIds = new Set(data.nodes.filter((n) => n.isSeed).map((n) => n.id));
  if (!seedIds.size) return data;

  const nodeId = (ref: string | GraphRenderNode) =>
    typeof ref === "string" ? ref : ref.id;

  const nodes = data.nodes.filter((n) => seedIds.has(n.id));
  const links = data.links.filter((l) => {
    const s = nodeId(l.source as string | GraphRenderNode);
    const t = nodeId(l.target as string | GraphRenderNode);
    return seedIds.has(s) && seedIds.has(t);
  });

  return { nodes, links };
}

/** Add nodes for skills not yet linked to the world graph (local:* ids). */
export function appendLocalSkillNodes(
  data: GraphRenderData,
  localSkills: { id: string; label: string; strength: number }[],
): GraphRenderData {
  const existing = new Set(data.nodes.map((n) => n.id));
  const extra = localSkills
    .filter((s) => s.id.startsWith("local:") && !existing.has(s.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      category: "language" as const,
      activation: s.strength / 10,
      evidence: s.strength / 10,
      isSeed: true,
      strength: s.strength,
    }));

  if (!extra.length) return data;
  return { nodes: [...data.nodes, ...extra], links: data.links };
}

/** Lightweight render data for a small updated-skills subgraph (no activation pass). */
export function buildUpdatedSubgraphData(
  nodes: { id: string; label: string; category?: SkillCategory }[],
  edges: { from: string; to: string; type: string; weight?: number }[],
): GraphRenderData {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const renderNodes: GraphRenderNode[] = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    category: n.category ?? "concept",
    activation: 0.92,
    evidence: 0.92,
    isSeed: true,
  }));
  const links: GraphRenderLink[] = [];
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    links.push({
      source: e.from,
      target: e.to,
      type: e.type,
      weight: e.weight ?? 0.55,
      energy: 0.75,
    });
  }
  return { nodes: renderNodes, links };
}

import { API_BASE } from "@/lib/api-base";
import type { SkillCategory, SkillGraph, SkillRelationType } from "../types/knowledgeGraph";

export interface SkillAnalysisUsage {
  model?: string | null;
  inputTokens: number;
  cachedTokens?: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  savings?: number | null;
}

export interface PendingSkill {
  normalizedKey: string;
  surfaceForm: string;
  status: string;
  createdAt?: string;
  attempts?: number;
  error?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  total?: number;
}

export interface EnrichmentSession {
  running: boolean;
  status: string;
  sessionId?: string;
  mode?: string;
  processed?: number;
  failed?: number;
  remaining?: number;
  nodesUpdated?: number;
  relationshipsUpdated?: number;
  updatedSkillIds?: string[];
  usage?: SkillAnalysisUsage | null;
  lastSkill?: { normalizedKey: string; surfaceForm: string; skillId?: string; path?: string } | null;
  startedAt?: string;
  finishedAt?: string | null;
  cancelled?: boolean;
}

export interface SkillSubgraph {
  nodes: WorldGraphNode[];
  edges: WorldGraphEdge[];
}

export interface WorldGraphNode {
  id: string;
  label: string;
  category: SkillCategory;
  skillType?: string;
  rawCategory?: string;
}

export interface WorldGraphEdge {
  from: string;
  to: string;
  type: SkillRelationType | string;
  weight: number;
}

export interface UserGraphSkill {
  surfaceForm: string;
  normalizedKey: string;
  canonicalId: string | null;
  category?: "hard" | "soft" | "devops" | "tools" | "domain";
  level?: number;
  strength?: number;
  proficiency?: number;
  sources?: string[];
}

export interface UserKnowledgeGraph {
  applierName: string;
  resumeId: string;
  resumeName: string;
  skills: UserGraphSkill[];
  edges?: { fromId: string; toId: string; type: string; weight: number }[];
  updatedAt?: string;
}

export function toSkillGraph(nodes: WorldGraphNode[], edges: WorldGraphEdge[]): SkillGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      category: n.category,
    })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type as SkillRelationType,
      weight: e.weight,
    })),
  };
}

export async function fetchWorldGraph(): Promise<{
  graph: SkillGraph;
  totalNodes: number;
  truncated: boolean;
  queueStats: QueueStats;
}> {
  const res = await fetch(`${API_BASE}/skills/graph/world`);
  const data = (await res.json()) as {
    success?: boolean;
    graph?: { nodes: WorldGraphNode[]; edges: WorldGraphEdge[]; totalNodes: number; truncated: boolean };
    queueStats?: QueueStats;
    error?: string;
  };
  if (!res.ok || !data.success || !data.graph) {
    throw new Error(data.error || "Failed to load world graph");
  }
  return {
    graph: toSkillGraph(data.graph.nodes, data.graph.edges),
    totalNodes: data.graph.totalNodes,
    truncated: data.graph.truncated,
    queueStats: data.queueStats || { pending: 0, processing: 0, done: 0, failed: 0 },
  };
}

export async function fetchPendingSkills(limit = 200): Promise<{ pending: PendingSkill[]; stats: QueueStats }> {
  const res = await fetch(`${API_BASE}/skills/enrichment/pending?limit=${limit}`);
  const data = (await res.json()) as {
    success?: boolean;
    pending?: PendingSkill[];
    stats?: QueueStats;
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load pending skills");
  return { pending: data.pending || [], stats: data.stats || { pending: 0, processing: 0, done: 0, failed: 0 } };
}

export async function fetchEnrichmentStatus(): Promise<{ session: EnrichmentSession; stats: QueueStats }> {
  const res = await fetch(`${API_BASE}/skills/enrichment/status`);
  const data = (await res.json()) as {
    success?: boolean;
    session?: EnrichmentSession;
    stats?: QueueStats;
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load enrichment status");
  return {
    session: data.session || { running: false, status: "idle" },
    stats: data.stats || { pending: 0, processing: 0, done: 0, failed: 0 },
  };
}

export async function startEnrichment(options: {
  applierName?: string;
  mode?: "fast" | "smart";
  limit?: number;
}): Promise<{ sessionId: string; mode: string; pending: number }> {
  const res = await fetch(`${API_BASE}/skills/enrichment/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const data = (await res.json()) as {
    success?: boolean;
    sessionId?: string;
    mode?: string;
    pending?: number;
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to start enrichment");
  return { sessionId: data.sessionId || "", mode: data.mode || "fast", pending: data.pending ?? 0 };
}

export async function stopEnrichment(): Promise<void> {
  const res = await fetch(`${API_BASE}/skills/enrichment/stop`, { method: "POST" });
  const data = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to stop enrichment");
}

export async function fetchUserGraphs(applierName: string): Promise<UserKnowledgeGraph[]> {
  const res = await fetch(
    `${API_BASE}/user-graph?applierName=${encodeURIComponent(applierName)}`,
  );
  const data = (await res.json()) as {
    success?: boolean;
    graphs?: UserKnowledgeGraph[];
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load user graphs");
  return data.graphs || [];
}

export function formatEnrichmentCost(usage?: SkillAnalysisUsage | null): string | null {
  if (!usage || usage.cost == null || !Number.isFinite(usage.cost)) return null;
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  if (inTok + outTok === 0) {
    return usage.cost === 0 ? "$0.0000 · graph only" : `$${usage.cost.toFixed(4)}`;
  }
  return `$${usage.cost.toFixed(4)} · ${inTok.toLocaleString()} in · ${outTok.toLocaleString()} out`;
}

export interface GraphSkill {
  id: string;
  label: string;
  category: string;
  skillType?: string;
}

export interface SkillListPagination {
  total: number;
  page: number;
  limit: number;
}

export async function fetchSkillList(options: {
  q?: string;
  page?: number;
  limit?: number;
}): Promise<{ skills: GraphSkill[]; pagination: SkillListPagination }> {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  params.set("page", String(options.page ?? 1));
  params.set("limit", String(options.limit ?? 30));

  const res = await fetch(`${API_BASE}/skills/list?${params}`);
  const data = (await res.json()) as {
    success?: boolean;
    skills?: GraphSkill[];
    pagination?: SkillListPagination;
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load skills");
  return {
    skills: data.skills || [],
    pagination: data.pagination || { total: 0, page: 1, limit: 30 },
  };
}

export async function fetchMatchingSkillIds(q: string, maxIds = 200): Promise<{ ids: string[]; total: number }> {
  const params = new URLSearchParams({ idsOnly: "true", maxIds: String(maxIds) });
  if (q.trim()) params.set("q", q.trim());

  const res = await fetch(`${API_BASE}/skills/list?${params}`);
  const data = (await res.json()) as {
    success?: boolean;
    ids?: string[];
    total?: number;
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load skill ids");
  return { ids: data.ids || [], total: data.total ?? 0 };
}

export async function fetchSkillSubgraph(
  skillIds: string[],
  internal = true,
): Promise<SkillSubgraph> {
  const capped = skillIds.slice(0, 80);
  if (!capped.length) return { nodes: [], edges: [] };
  const params = new URLSearchParams({
    ids: capped.join(","),
    ...(internal ? { internal: "true" } : {}),
  });
  const res = await fetch(`${API_BASE}/skills/graph/subgraph?${params}`);
  const data = (await res.json()) as {
    success?: boolean;
    graph?: SkillSubgraph;
    error?: string;
  };
  if (!res.ok || !data.success || !data.graph) {
    throw new Error(data.error || "Failed to load skill subgraph");
  }
  return data.graph;
}

export async function enhanceSkillRelations(options: {
  skillIds: string[];
  applierName?: string;
}): Promise<{
  skillsProcessed: number;
  relationshipsProposed: number;
  relationshipsApplied: number;
  nodesUpdated: number;
  relationshipsUpdated: number;
  updatedSkillIds: string[];
  usage?: SkillAnalysisUsage | null;
}> {
  const res = await fetch(`${API_BASE}/skills/enrichment/enhance-relations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const data = (await res.json()) as {
    success?: boolean;
    skillsProcessed?: number;
    relationshipsProposed?: number;
    relationshipsApplied?: number;
    nodesUpdated?: number;
    relationshipsUpdated?: number;
    updatedSkillIds?: string[];
    usage?: SkillAnalysisUsage | null;
    error?: string;
  };
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to enhance relations");
  return {
    skillsProcessed: data.skillsProcessed ?? 0,
    relationshipsProposed: data.relationshipsProposed ?? 0,
    relationshipsApplied: data.relationshipsApplied ?? 0,
    nodesUpdated: data.nodesUpdated ?? data.skillsProcessed ?? 0,
    relationshipsUpdated: data.relationshipsUpdated ?? data.relationshipsApplied ?? 0,
    updatedSkillIds: data.updatedSkillIds ?? options.skillIds,
    usage: data.usage ?? null,
  };
}

import type {
  ActivationResult,
  SkillEdge,
  SkillGraph,
  SkillRelationType,
} from "../../../types/knowledgeGraph";

/**
 * Spreading-activation engine for the skill knowledge graph.
 *
 * The model has three layers (see the plan):
 *   A. The graph itself: typed, weighted edges (authored).
 *   B. Hebbian learning: edges between skills that co-occur on active resumes
 *      get strengthened via normalized pointwise mutual information (PMI).
 *   C. Spreading activation: a Personalized PageRank / random-walk-with-restart
 *      seeded by an "evidence" vector built from the active profile. This is the
 *      neuron-like glow that ripples out from the skills a person actually has.
 *
 *   a = (1 - alpha) * (I - alpha * W~)^-1 * e
 *
 * computed by power iteration. All functions here are pure (no React, no DOM)
 * so they are trivially unit-testable.
 */

/** Per-relation-type base coupling multiplier applied on top of edge.weight. */
export const RELATION_MULTIPLIER: Record<SkillRelationType, number> = {
  PREREQUISITE_OF: 1.0,
  BUILDS_ON: 0.95,
  USED_WITH: 0.8,
  RELATED_TO: 0.6,
  PART_OF: 0.7,
};

export interface EvidenceItem {
  /** Resolved node id. */
  id: string;
  /** Proficiency in [0, 1] (depth of skill). */
  proficiency: number;
  /** Age in years since the skill was last used (drives recency decay). */
  ageYears: number;
  /** Number of times the skill appears across the active profile. */
  freq: number;
  /** Resume/profile ids that contributed this evidence. */
  sources: string[];
}

export interface ActivationParams {
  /** Damping / spread factor in [0, 1). Higher = activation travels further. */
  alpha: number;
  /** Recency decay rate (per year). */
  lambda: number;
  /** Hebbian learning rate applied to PMI co-occurrence boosts. */
  eta: number;
  /** Max power-iteration steps. */
  maxIterations: number;
  /** L1 convergence tolerance. */
  tolerance: number;
}

export const DEFAULT_PARAMS: ActivationParams = {
  alpha: 0.82,
  lambda: 0.35,
  eta: 0.6,
  maxIterations: 100,
  tolerance: 1e-6,
};

/** Directed key for an effective edge weight. */
export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Build the symmetric effective-weight map for every edge, combining the
 * authored base weight, the relation-type multiplier, and the Hebbian
 * co-occurrence boost. Activation flows both directions along an edge (the
 * graph is treated as undirected for diffusion purposes), so each edge is
 * emitted in both directions.
 */
export function buildEffectiveWeights(
  graph: SkillGraph,
  cooccurrence: Record<string, number>,
  params: ActivationParams,
): Record<string, number> {
  const weights: Record<string, number> = {};

  const add = (from: string, to: string, w: number) => {
    const k = edgeKey(from, to);
    weights[k] = Math.max(weights[k] ?? 0, w);
  };

  for (const edge of graph.edges) {
    const base = edge.weight * RELATION_MULTIPLIER[edge.type];
    const hebbian = params.eta * (cooccurrence[edgeKey(edge.from, edge.to)] ?? 0);
    const effective = Math.min(1, base + hebbian);
    add(edge.from, edge.to, effective);
    add(edge.to, edge.from, effective);
  }

  return weights;
}

/**
 * Hebbian co-occurrence via normalized PMI.
 *
 * For each pair of skills that appear together on the same resume we count the
 * co-occurrence; PMI compares observed joint frequency against what we'd expect
 * if the skills were independent. Normalized PMI is squashed to [0, 1].
 *
 * @param profiles list of node-id arrays, one per active resume.
 */
export function cooccurrencePMI(
  profiles: string[][],
  graph: SkillGraph,
): Record<string, number> {
  const result: Record<string, number> = {};
  const n = profiles.length;
  if (n === 0) return result;

  const single: Record<string, number> = {};
  const pair: Record<string, number> = {};

  for (const profile of profiles) {
    const unique = Array.from(new Set(profile));
    for (const id of unique) single[id] = (single[id] ?? 0) + 1;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        pair[k] = (pair[k] ?? 0) + 1;
      }
    }
  }

  // Only emit boosts for pairs that are also connected in the graph, so
  // co-occurrence reinforces existing structure rather than inventing edges.
  for (const edge of graph.edges) {
    const a = edge.from;
    const b = edge.to;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const pAB = (pair[k] ?? 0) / n;
    if (pAB === 0) continue;
    const pA = (single[a] ?? 0) / n;
    const pB = (single[b] ?? 0) / n;
    if (pA === 0 || pB === 0) continue;
    const pmi = Math.log(pAB / (pA * pB));
    // Normalized PMI in [-1, 1]; clamp negatives to 0 and scale to [0, 1].
    const npmi = pmi / -Math.log(pAB);
    const boost = Math.max(0, npmi);
    if (boost > 0) result[edgeKey(a, b)] = boost;
  }

  return result;
}

/**
 * Build the normalized evidence (stimulus) vector e from per-skill evidence.
 *   e_i ∝ proficiency_i * recency_i * log(1 + freq_i),  recency_i = e^(-lambda * age)
 * The vector is L1-normalized so it forms a probability distribution.
 */
export function buildEvidenceVector(
  items: EvidenceItem[],
  params: ActivationParams,
): { vector: Record<string, number>; contributors: Record<string, string[]> } {
  const vector: Record<string, number> = {};
  const contributors: Record<string, string[]> = {};

  for (const item of items) {
    const recency = Math.exp(-params.lambda * Math.max(0, item.ageYears));
    const raw = item.proficiency * recency * Math.log(1 + item.freq);
    vector[item.id] = (vector[item.id] ?? 0) + raw;
    contributors[item.id] = Array.from(
      new Set([...(contributors[item.id] ?? []), ...item.sources]),
    );
  }

  const total = Object.values(vector).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const id of Object.keys(vector)) vector[id] /= total;
  }

  return { vector, contributors };
}

/**
 * Personalized PageRank by power iteration.
 *
 * Transition is column-normalized over the effective (undirected) weights:
 * a node distributes its activation to neighbors proportional to edge weight.
 * Dangling nodes (no neighbors) keep their share via the restart term.
 *
 *   a^(t+1) = alpha * W~ * a^(t) + (1 - alpha) * e
 */
export function personalizedPageRank(
  nodeIds: string[],
  effectiveWeights: Record<string, number>,
  evidence: Record<string, number>,
  params: ActivationParams,
): { activation: Record<string, number>; iterations: number } {
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const n = nodeIds.length;

  // Build adjacency (out-neighbors) and per-node out-weight sums.
  const neighbors: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  const outSum = new Float64Array(n);

  for (const [key, w] of Object.entries(effectiveWeights)) {
    const [from, to] = key.split("->");
    const fi = index.get(from);
    const ti = index.get(to);
    if (fi === undefined || ti === undefined || w <= 0) continue;
    neighbors[fi].push({ to: ti, w });
    outSum[fi] += w;
  }

  // Restart vector e (fall back to uniform if no evidence).
  const e = new Float64Array(n);
  let eTotal = 0;
  for (const id of nodeIds) eTotal += evidence[id] ?? 0;
  if (eTotal > 0) {
    for (let i = 0; i < n; i++) e[i] = (evidence[nodeIds[i]] ?? 0) / eTotal;
  } else {
    for (let i = 0; i < n; i++) e[i] = 1 / n;
  }

  let a = new Float64Array(e);
  let iterations = 0;

  for (let step = 0; step < params.maxIterations; step++) {
    const next = new Float64Array(n);

    // Restart term.
    for (let i = 0; i < n; i++) next[i] = (1 - params.alpha) * e[i];

    // Spread term + collect dangling mass.
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (outSum[i] === 0) {
        dangling += a[i];
        continue;
      }
      const share = (params.alpha * a[i]) / outSum[i];
      const outs = neighbors[i];
      for (let j = 0; j < outs.length; j++) {
        next[outs[j].to] += share * outs[j].w;
      }
    }
    // Redistribute dangling mass according to the restart distribution.
    if (dangling > 0) {
      for (let i = 0; i < n; i++) next[i] += params.alpha * dangling * e[i];
    }

    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(next[i] - a[i]);
    a = next;
    iterations = step + 1;
    if (diff < params.tolerance) break;
  }

  // Max-normalize for rendering so the brightest node maps to 1.
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, a[i]);
  const activation: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    activation[nodeIds[i]] = max > 0 ? a[i] / max : 0;
  }

  return { activation, iterations };
}

/**
 * End-to-end: given the graph, the active profile's evidence, and active
 * profiles for co-occurrence, compute the full activation result.
 */
export function computeActivation(
  graph: SkillGraph,
  evidenceItems: EvidenceItem[],
  profiles: string[][],
  params: ActivationParams = DEFAULT_PARAMS,
): ActivationResult {
  const cooccurrence = cooccurrencePMI(profiles, graph);
  const effectiveWeights = buildEffectiveWeights(graph, cooccurrence, params);
  const { vector: evidence, contributors } = buildEvidenceVector(evidenceItems, params);
  const nodeIds = graph.nodes.map((n) => n.id);
  const { activation, iterations } = personalizedPageRank(
    nodeIds,
    effectiveWeights,
    evidence,
    params,
  );

  return {
    activation,
    evidence,
    contributors,
    edgeWeights: effectiveWeights,
    iterations,
  };
}

/** Convenience: dedupe a relation list down to the strongest undirected edges. */
export function strongestNeighbors(
  nodeId: string,
  edges: SkillEdge[],
  effectiveWeights: Record<string, number>,
  limit = 8,
): { id: string; weight: number }[] {
  const seen = new Map<string, number>();
  for (const edge of edges) {
    let other: string | null = null;
    if (edge.from === nodeId) other = edge.to;
    else if (edge.to === nodeId) other = edge.from;
    if (!other) continue;
    const w = effectiveWeights[edgeKey(nodeId, other)] ?? effectiveWeights[edgeKey(other, nodeId)] ?? edge.weight;
    seen.set(other, Math.max(seen.get(other) ?? 0, w));
  }
  return Array.from(seen.entries())
    .map(([id, weight]) => ({ id, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

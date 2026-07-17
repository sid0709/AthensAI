/**
 * Skill knowledge graph types.
 *
 * These are intentionally shaped to map 1:1 onto a Neo4j property graph so the
 * client-side fixture can later be swapped for live Cypher queries with no UI
 * changes:
 *   (:Skill {id, label, category})-[:RELATION_TYPE {weight}]->(:Skill)
 */

export type SkillCategory =
  | "language"
  | "frontend"
  | "backend"
  | "cloud"
  | "database"
  | "devops"
  | "data"
  | "mobile"
  | "concept";

/** Edge semantics. Each type carries a different base coupling strength. */
export type SkillRelationType =
  | "PREREQUISITE_OF" // directed: JavaScript -> React
  | "BUILDS_ON" // directed: Remix -> React
  | "RELATED_TO" // symmetric similarity
  | "PART_OF" // taxonomy: React -> Frontend
  | "USED_WITH"; // ecosystem co-occurrence: .NET <-> Azure

export interface SkillNode {
  id: string;
  label: string;
  category: SkillCategory;
  /** Optional editorial description shown in the inspector. */
  blurb?: string;
}

export interface SkillEdge {
  from: string;
  to: string;
  type: SkillRelationType;
  /** Authored base coupling weight in [0, 1]. */
  weight: number;
}

export interface SkillGraph {
  nodes: SkillNode[];
  edges: SkillEdge[];
}

/**
 * Result of running spreading activation (Personalized PageRank) over the
 * graph for a given set of active profiles/resumes.
 */
export interface ActivationResult {
  /** nodeId -> activation value in [0, 1] (max-normalized). */
  activation: Record<string, number>;
  /** nodeId -> raw evidence (direct stimulus) in [0, 1]. */
  evidence: Record<string, number>;
  /** nodeId -> set of resume ids that contributed direct evidence. */
  contributors: Record<string, string[]>;
  /**
   * Effective edge weights after Hebbian co-occurrence boosting, keyed by
   * `${from}->${to}`. Drives edge thickness/opacity in the renderer.
   */
  edgeWeights: Record<string, number>;
  /** Number of power-iteration steps taken to converge. */
  iterations: number;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillGraph, ActivationResult } from "../../../types/knowledgeGraph";
import {
  fetchWorldGraph,
  fetchUserGraphs,
  type UserKnowledgeGraph,
} from "@/app/api/skillGraph";
import { fetchUserResumes } from "@/app/services/resumeApi";
import { useApplier } from "@/context/applier-context";
import {
  computeActivation,
  DEFAULT_PARAMS,
  type EvidenceItem,
} from "../lib/activation";
import { buildGraphData, type GraphRenderData } from "../lib/graphAdapter";

export interface ProfileOption {
  id: string;
  /** Display label — tech stack for resumes, aggregated label for profile. */
  name: string;
  /** Original resume filename (tooltip). */
  subtitle?: string;
  skillIds: string[];
  graph: UserKnowledgeGraph;
}

export interface UseSkillGraphOptions {
  /** When set, only this resumeId graph is used as activation seeds. */
  fixedResumeId?: string | null;
  /** Exclude graphs with these resumeIds from the profile list. */
  excludeResumeIds?: readonly string[];
  /** Fetch the full Neo4j world graph and run spreading activation (force-graph UI). */
  loadWorldGraph?: boolean;
}

const EMPTY_EXCLUDE: readonly string[] = [];

function graphProfileId(g: UserKnowledgeGraph): string {
  return `${g.applierName}:${g.resumeId}`;
}

function skillProficiency(skill: UserKnowledgeGraph["skills"][number]): number {
  if (typeof skill.proficiency === "number") return skill.proficiency;
  if (typeof skill.strength === "number") return skill.strength / 10;
  return 0.85;
}

function buildEvidence(
  active: Set<string>,
  profiles: ProfileOption[],
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const profile of profiles) {
    if (!active.has(profile.id)) continue;
    const counts = new Map<string, number>();
    for (const s of profile.graph.skills) {
      const id =
        s.canonicalId ||
        (s.normalizedKey ? `local:${s.normalizedKey}` : null);
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, freq] of counts) {
      const skill = profile.graph.skills.find(
        (s) =>
          s.canonicalId === id ||
          (s.normalizedKey && `local:${s.normalizedKey}` === id),
      );
      items.push({
        id,
        proficiency: skill ? skillProficiency(skill) : 0.85,
        ageYears: 0.05,
        freq,
        sources: [profile.id],
      });
    }
  }
  return items;
}

function buildStrengthMaps(
  active: Set<string>,
  profiles: ProfileOption[],
  worldGraph: SkillGraph | null,
) {
  const strengthByNodeId: Record<string, number> = {};
  const skillStrengthList: { id: string; label: string; strength: number }[] = [];
  const labels = new Map((worldGraph?.nodes ?? []).map((n) => [n.id, n.label]));

  for (const profile of profiles) {
    if (!active.has(profile.id)) continue;
    for (const s of profile.graph.skills) {
      const id =
        s.canonicalId ||
        (s.normalizedKey ? `local:${s.normalizedKey}` : null);
      if (!id) continue;
      const strength =
        typeof s.strength === "number"
          ? s.strength
          : typeof s.proficiency === "number"
            ? s.proficiency * 10
            : undefined;
      if (strength == null) continue;
      const prev = strengthByNodeId[id];
      if (prev == null || strength > prev) {
        strengthByNodeId[id] = strength;
      }
    }
  }

  for (const [id, strength] of Object.entries(strengthByNodeId)) {
    const fromWorld = labels.get(id);
    const fromProfile = profiles
      .flatMap((p) => p.graph.skills)
      .find(
        (s) =>
          s.canonicalId === id ||
          (s.normalizedKey && `local:${s.normalizedKey}` === id),
      );
    skillStrengthList.push({
      id,
      label: fromWorld ?? fromProfile?.surfaceForm ?? id.replace(/^local:/, ""),
      strength,
    });
  }
  skillStrengthList.sort((a, b) => b.strength - a.strength);

  return { strengthByNodeId, skillStrengthList };
}

export interface UseSkillGraphResult {
  profiles: ProfileOption[];
  activeResumeIds: Set<string>;
  toggleResume: (id: string) => void;
  setAllResumes: (active: boolean) => void;
  alpha: number;
  setAlpha: (a: number) => void;
  graphData: GraphRenderData;
  result: ActivationResult;
  worldGraph: SkillGraph | null;
  loading: boolean;
  error: string | null;
  totalNodes: number;
  truncated: boolean;
  refreshWorldGraph: () => Promise<void>;
  searchNodes: { id: string; label: string; category: import("../../../types/knowledgeGraph").SkillCategory }[];
  strengthByNodeId: Record<string, number>;
  skillStrengthList: { id: string; label: string; strength: number }[];
}

export function useSkillGraph(options: UseSkillGraphOptions = {}): UseSkillGraphResult {
  const { fixedResumeId, excludeResumeIds = EMPTY_EXCLUDE, loadWorldGraph = false } = options;
  const excludeKey = excludeResumeIds.join("\0");
  const { applier } = useApplier();
  const [worldGraph, setWorldGraph] = useState<SkillGraph | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [activeResumeIds, setActiveResumeIds] = useState<Set<string>>(new Set());
  const [alpha, setAlpha] = useState(DEFAULT_PARAMS.alpha);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalNodes, setTotalNodes] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const worldGraphRef = useRef<SkillGraph | null>(null);
  worldGraphRef.current = worldGraph;

  const loadUserProfiles = useCallback(async () => {
    const applierName = applier?.name;
    if (!applierName) {
      setProfiles([]);
      setActiveResumeIds(new Set());
      return;
    }

    const [graphs, resumes] = await Promise.all([
      fetchUserGraphs(applierName),
      fetchUserResumes(applierName).catch(() => []),
    ]);
    const techByResumeId = new Map(resumes.map((r) => [r.id, r.techStack]));
    const excluded = new Set(excludeResumeIds);
    const filtered = graphs.filter((g) => !excluded.has(g.resumeId));
    const nextProfiles: ProfileOption[] = filtered.map((g) => {
      const isProfile = g.resumeId === "__profile__";
      const fileName = g.resumeName || g.resumeId;
      const techStack = isProfile
        ? "Profile (all resumes)"
        : techByResumeId.get(g.resumeId) || fileName;
      return {
        id: graphProfileId(g),
        name: techStack,
        subtitle: isProfile ? undefined : fileName,
        skillIds: g.skills.map((s) => s.canonicalId).filter(Boolean) as string[],
        graph: g,
      };
    });
    setProfiles(nextProfiles);

    if (fixedResumeId) {
      const match = nextProfiles.find((p) => p.graph.resumeId === fixedResumeId);
      setActiveResumeIds(match ? new Set([match.id]) : new Set());
    } else {
      setActiveResumeIds((prev) => {
        if (prev.size > 0) {
          const kept = new Set([...prev].filter((id) => nextProfiles.some((p) => p.id === id)));
          if (kept.size > 0) return kept;
        }
        return nextProfiles.length ? new Set([nextProfiles[0].id]) : new Set();
      });
    }
  }, [applier?.name, excludeKey, fixedResumeId]);

  const refreshWorldGraph = useCallback(async () => {
    const hasWorld = Boolean(worldGraphRef.current?.nodes.length);
    if (!hasWorld) setLoading(true);
    setError(null);
    try {
      if (loadWorldGraph) {
        const { graph, totalNodes: total, truncated: trunc } = await fetchWorldGraph();
        setWorldGraph(graph);
        setTotalNodes(total);
        setTruncated(trunc);
      }
      await loadUserProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, excludeKey, fixedResumeId, loadUserProfiles, loadWorldGraph]);

  useEffect(() => {
    void refreshWorldGraph();
  }, [refreshWorldGraph]);

  const toggleResume = (id: string) => {
    if (fixedResumeId) return;
    setActiveResumeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAllResumes = (active: boolean) => {
    if (fixedResumeId) return;
    setActiveResumeIds(active ? new Set(profiles.map((p) => p.id)) : new Set());
  };

  const { graphData, result, strengthByNodeId, skillStrengthList } = useMemo(() => {
    const empty: ActivationResult = {
      activation: {},
      evidence: {},
      contributors: {},
      edgeWeights: {},
      iterations: 0,
    };
    if (!loadWorldGraph || !worldGraph?.nodes.length) {
      const { strengthByNodeId: strengths, skillStrengthList: list } = buildStrengthMaps(
        activeResumeIds,
        profiles,
        worldGraph,
      );
      return {
        graphData: { nodes: [], links: [] } as GraphRenderData,
        result: empty,
        strengthByNodeId: strengths,
        skillStrengthList: list,
      };
    }

    const evidence = buildEvidence(activeResumeIds, profiles);
    const activeProfiles = profiles
      .filter((p) => activeResumeIds.has(p.id))
      .map((p) => p.skillIds);
    const res = computeActivation(worldGraph, evidence, activeProfiles, {
      ...DEFAULT_PARAMS,
      alpha,
    });
    const { strengthByNodeId: strengths, skillStrengthList: list } = buildStrengthMaps(
      activeResumeIds,
      profiles,
      worldGraph,
    );
    return {
      graphData: buildGraphData(worldGraph, res, strengths),
      result: res,
      strengthByNodeId: strengths,
      skillStrengthList: list,
    };
  }, [activeResumeIds, alpha, loadWorldGraph, profiles, worldGraph]);

  const searchNodes = useMemo(
    () =>
      (worldGraph?.nodes || []).map((n) => ({
        id: n.id,
        label: n.label,
        category: n.category,
      })),
    [worldGraph],
  );

  return {
    profiles,
    activeResumeIds,
    toggleResume,
    setAllResumes,
    alpha,
    setAlpha,
    graphData,
    result,
    worldGraph,
    loading,
    error,
    totalNodes,
    truncated,
    refreshWorldGraph,
    searchNodes,
    strengthByNodeId,
    skillStrengthList,
  };
}

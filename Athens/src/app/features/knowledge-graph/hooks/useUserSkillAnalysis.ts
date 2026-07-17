import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivationResult } from "../../../types/knowledgeGraph";
import { fetchUserGraphs, type UserKnowledgeGraph } from "@/app/api/skillGraph";
import { fetchUserResumes } from "@/app/services/resumeApi";
import { useApplier } from "@/context/applier-context";
import { DEFAULT_PARAMS } from "../lib/activation";
import type { GraphRenderData } from "../lib/graphAdapter";
import type { UseSkillGraphResult } from "./useSkillGraph";
import {
  normalizeSkillCategory,
  resolveSkillLevel,
  type CategorizedSkill,
} from "../../resumes/lib/skillCategories";

export interface ProfileOption {
  id: string;
  name: string;
  subtitle?: string;
  skillIds: string[];
  graph: UserKnowledgeGraph;
}

export interface UseUserSkillAnalysisOptions {
  fixedResumeId?: string | null;
  excludeResumeIds?: readonly string[];
}

const EMPTY_EXCLUDE: readonly string[] = [];

function graphProfileId(g: UserKnowledgeGraph): string {
  return `${g.applierName}:${g.resumeId}`;
}

function buildSkillStrengthList(
  active: Set<string>,
  profiles: ProfileOption[],
): { id: string; label: string; strength: number; category: CategorizedSkill["category"]; level: number }[] {
  const strengthByNodeId: Record<string, number> = {};
  const metaByNodeId: Record<string, { label: string; category: CategorizedSkill["category"]; level: number }> = {};

  for (const profile of profiles) {
    if (!active.has(profile.id)) continue;
    for (const s of profile.graph.skills) {
      const id =
        s.canonicalId ||
        (s.normalizedKey ? `local:${s.normalizedKey}` : null);
      if (!id) continue;
      const level =
        typeof s.level === "number"
          ? Math.max(1, Math.min(5, Math.round(s.level)))
          : resolveSkillLevel({ strength: s.strength });
      const category = normalizeSkillCategory(s.category);
      const strength =
        typeof s.strength === "number" && s.strength <= 10
          ? s.strength
          : level * 2;
      const prev = strengthByNodeId[id];
      if (prev == null || level > (metaByNodeId[id]?.level ?? 0)) {
        strengthByNodeId[id] = strength;
        metaByNodeId[id] = {
          label: s.surfaceForm ?? id.replace(/^local:/, ""),
          category,
          level,
        };
      }
    }
  }

  const skillStrengthList: { id: string; label: string; strength: number; category: CategorizedSkill["category"]; level: number }[] = [];
  for (const [id, strength] of Object.entries(strengthByNodeId)) {
    const meta = metaByNodeId[id];
    if (!meta) continue;
    skillStrengthList.push({
      id,
      label: meta.label,
      strength,
      category: meta.category,
      level: meta.level,
    });
  }
  skillStrengthList.sort((a, b) => b.level - a.level || a.label.localeCompare(b.label));
  return skillStrengthList;
}

const EMPTY_ACTIVATION: ActivationResult = {
  activation: {},
  evidence: {},
  contributors: {},
  edgeWeights: {},
  iterations: 0,
};

/**
 * Lightweight skill analysis for Settings and Resume tabs.
 * Loads user graphs only — no world graph fetch or spreading activation.
 */
export function useUserSkillAnalysis(
  options: UseUserSkillAnalysisOptions = {},
): UseSkillGraphResult {
  const { fixedResumeId, excludeResumeIds = EMPTY_EXCLUDE } = options;
  const excludeKey = excludeResumeIds.join("\0");
  const { applier } = useApplier();
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [activeResumeIds, setActiveResumeIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skill analysis");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, excludeKey, fixedResumeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const skillStrengthList = useMemo(
    () => buildSkillStrengthList(activeResumeIds, profiles),
    [activeResumeIds, profiles],
  );

  const strengthByNodeId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of skillStrengthList) map[s.id] = s.strength;
    return map;
  }, [skillStrengthList]);

  return {
    profiles,
    activeResumeIds,
    toggleResume,
    setAllResumes,
    alpha: DEFAULT_PARAMS.alpha,
    setAlpha: () => {},
    graphData: { nodes: [], links: [] } as GraphRenderData,
    result: EMPTY_ACTIVATION,
    worldGraph: null,
    loading,
    error,
    totalNodes: 0,
    truncated: false,
    refreshWorldGraph: refresh,
    searchNodes: [],
    strengthByNodeId,
    skillStrengthList,
  };
}

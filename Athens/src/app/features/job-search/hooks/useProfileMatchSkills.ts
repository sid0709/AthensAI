import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import {
  buildClientMatchContext,
  rescoreJobWithContext,
  type ProfileMatchContext,
} from "../../../lib/skill-match";
import type { Job } from "../../../types";

export type UserSkillCategory = "hard" | "soft" | "devops" | "tools" | "domain";

export type UserSkill = {
  name: string;
  category: UserSkillCategory;
  level: number;
  weight?: number;
};

type MatchSkillsResponse = {
  success?: boolean;
  skills?: UserSkill[];
  categories?: UserSkillCategory[];
  levelMin?: number;
  levelMax?: number;
  boostSkills?: string[];
  exactSkills?: string[];
  profileTokens?: string[];
  profileCompacts?: string[];
  boostCompacts?: string[];
  tokenWeights?: Record<string, number>;
  compactWeights?: { c: string; w: number }[];
  categoryWeights?: Record<string, number>;
  error?: string;
  profileVersion?: number;
  dictionaryVersion?: string;
};

type AddSkillResponse = MatchSkillsResponse & {
  skillHighlights?: { name: string; matched: boolean }[];
  skillsCovered?: number;
  skillsRequired?: number;
  scoreSkill?: number;
  added?: boolean;
};

function contextFromResponse(res: MatchSkillsResponse): ProfileMatchContext {
  return buildClientMatchContext(
    res.profileTokens ?? [],
    res.profileCompacts ?? res.boostCompacts ?? [],
    res.tokenWeights ?? {},
    res.compactWeights ?? [],
    res.categoryWeights ?? {},
  );
}

function useProfileMatchSkillsState(enabled = true) {
  const { post, get, del } = useApi(API_BASE);
  const { applier } = useApplier();
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [boostSkills, setBoostSkills] = useState<string[]>([]);
  const [exactSkills, setExactSkills] = useState<string[]>([]);
  const [matchContext, setMatchContext] = useState<ProfileMatchContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [boostingSkill, setBoostingSkill] = useState<string | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [dictionaryVersion, setDictionaryVersion] = useState<string | null>(null);

  const applyProfileResponse = useCallback((res: MatchSkillsResponse) => {
    setSkills(res.skills ?? []);
    setBoostSkills(res.boostSkills ?? []);
    setExactSkills(res.exactSkills ?? []);
    setMatchContext(contextFromResponse(res));
    if (typeof res.profileVersion === "number") setProfileVersion(res.profileVersion);
    if (typeof res.dictionaryVersion === "string") setDictionaryVersion(res.dictionaryVersion);
  }, []);

  const reload = useCallback(async () => {
    const name = applier?.name?.trim();
    if (!name || !enabled) return;
    setLoading(true);
    try {
      const res = (await get(
        `/personal/profile-match-skills?applierName=${encodeURIComponent(name)}`,
      )) as MatchSkillsResponse;
      if (res?.success) {
        applyProfileResponse(res);
      }
    } finally {
      setLoading(false);
    }
  }, [applier?.name, applyProfileResponse, enabled, get]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const boostSkillForJob = useCallback(
    async (
      skill: string,
      job: Job,
      options?: { category?: UserSkillCategory; level?: number },
    ): Promise<Job | null> => {
      const name = applier?.name?.trim();
      if (!name) return null;

      setBoostingSkill(skill);
      try {
        const res = (await post("/personal/profile-match-skills", {
          applierName: name,
          skill,
          category: options?.category,
          level: options?.level,
          jobSkills: job.skills,
        })) as AddSkillResponse;

        if (!res?.success) return null;

        applyProfileResponse(res);
        const ctx = contextFromResponse(res);

        if (res.skillHighlights?.length) {
          const skillScore = res.scoreSkill ?? 0;
          const vector = job.scores.vector;
          const overall =
            vector != null && vector > 0
              ? Math.round(0.55 * skillScore + 0.45 * vector)
              : skillScore;
          return {
            ...job,
            skillHighlights: res.skillHighlights,
            scores: {
              ...job.scores,
              skill: skillScore,
              overall,
              skillsCovered: res.skillsCovered,
              skillsRequired: res.skillsRequired,
            },
            matchScore: overall,
          };
        }

        return rescoreJobWithContext(job, ctx);
      } finally {
        setBoostingSkill(null);
      }
    },
    [applier?.name, applyProfileResponse, post],
  );

  const addSkill = useCallback(
    async (skill: string, category?: UserSkillCategory, level?: number): Promise<boolean> => {
      const name = applier?.name?.trim();
      const label = skill.trim();
      if (!name || !label) return false;

      setBoostingSkill(label);
      try {
        const res = (await post("/personal/profile-match-skills", {
          applierName: name,
          skill: label,
          category,
          level,
        })) as AddSkillResponse;
        if (!res?.success) return false;
        applyProfileResponse(res);
        return res.added !== false;
      } finally {
        setBoostingSkill(null);
      }
    },
    [applier?.name, applyProfileResponse, post],
  );

  const removeSkill = useCallback(
    async (skill: string): Promise<boolean> => {
      const name = applier?.name?.trim();
      const label = skill.trim();
      if (!name || !label) return false;

      setBoostingSkill(label);
      try {
        const res = (await del("/personal/profile-match-skills", {
          applierName: name,
          skill: label,
        })) as MatchSkillsResponse & { removed?: boolean };
        if (!res?.success) return false;
        applyProfileResponse(res);
        return res.removed !== false;
      } finally {
        setBoostingSkill(null);
      }
    },
    [applier?.name, applyProfileResponse, del],
  );

  return {
    skills,
    boostSkills,
    exactSkills,
    matchContext,
    profileVersion,
    dictionaryVersion,
    loading,
    boostingSkill,
    reload,
    boostSkillForJob,
    addSkill,
    removeSkill,
  };
}

type ProfileMatchSkillsValue = ReturnType<typeof useProfileMatchSkillsState>;
const ProfileMatchSkillsContext = createContext<ProfileMatchSkillsValue | null>(null);

export function ProfileMatchSkillsProvider({ children }: { children: ReactNode }) {
  const value = useProfileMatchSkillsState(true);
  return createElement(ProfileMatchSkillsContext.Provider, { value }, children);
}

export function useProfileMatchSkills(_enabled = true) {
  const value = useContext(ProfileMatchSkillsContext);
  if (!value) throw new Error("useProfileMatchSkills must be used inside ProfileMatchSkillsProvider");
  return value;
}

import { useCallback, useEffect, useState } from "react";
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
  error?: string;
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
  );
}

export function useProfileMatchSkills(enabled = true) {
  const { post, get, del } = useApi(API_BASE);
  const { applier } = useApplier();
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [boostSkills, setBoostSkills] = useState<string[]>([]);
  const [exactSkills, setExactSkills] = useState<string[]>([]);
  const [matchContext, setMatchContext] = useState<ProfileMatchContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [boostingSkill, setBoostingSkill] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const name = applier?.name?.trim();
    if (!name || !enabled) return;
    setLoading(true);
    try {
      const res = (await get(
        `/personal/profile-match-skills?applierName=${encodeURIComponent(name)}`,
      )) as MatchSkillsResponse;
      if (res?.success) {
        setSkills(res.skills ?? []);
        setBoostSkills(res.boostSkills ?? []);
        setExactSkills(res.exactSkills ?? []);
        setMatchContext(contextFromResponse(res));
      }
    } finally {
      setLoading(false);
    }
  }, [applier?.name, enabled, get]);

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

        setSkills(res.skills ?? []);
        setBoostSkills(res.boostSkills ?? []);
        const ctx = contextFromResponse(res);
        setMatchContext(ctx);

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
    [applier?.name, post],
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
        setSkills(res.skills ?? []);
        setBoostSkills(res.boostSkills ?? []);
        setExactSkills(res.exactSkills ?? []);
        setMatchContext(contextFromResponse(res));
        return res.added !== false;
      } finally {
        setBoostingSkill(null);
      }
    },
    [applier?.name, post],
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
        setSkills(res.skills ?? []);
        setBoostSkills(res.boostSkills ?? []);
        setExactSkills(res.exactSkills ?? []);
        setMatchContext(contextFromResponse(res));
        return res.removed !== false;
      } finally {
        setBoostingSkill(null);
      }
    },
    [applier?.name, del],
  );

  return {
    skills,
    boostSkills,
    exactSkills,
    matchContext,
    loading,
    boostingSkill,
    reload,
    boostSkillForJob,
    addSkill,
    removeSkill,
  };
}

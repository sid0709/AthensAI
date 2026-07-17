import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";

export type SkillRadarAxis = {
  skill: string;
  required: number;
  user: number;
  matchType: "direct" | "graph" | "none";
  matchedVia?: string;
  pathHops?: number;
  pathCost?: number;
  pathSkills?: string[];
  pathRelTypes?: string[];
};

export type AvailableResume = {
  resumeId: string;
  label: string;
};

export type JobSkillRadarData = {
  resumeId: string | null;
  resumeLabel: string;
  axes: SkillRadarAxis[];
  summary: { direct: number; graph: number; missing: number };
  availableResumes: AvailableResume[];
  recommendedResumeId: string | null;
  recommendedResumeTechStack?: string | null;
  skillAnalysisStatus?: string;
};

type RadarResponse = {
  success?: boolean;
  error?: string;
} & Partial<JobSkillRadarData>;

const PROFILE_RESUME_ID = "__profile__";

export function resolveRecommendedResumeId(
  available: AvailableResume[],
  recommendedResumeId?: string,
  recommendedTechStack?: string,
): string | undefined {
  if (!available.length) return recommendedResumeId;

  if (recommendedResumeId && available.some((r) => r.resumeId === recommendedResumeId)) {
    return recommendedResumeId;
  }

  if (recommendedTechStack) {
    const norm = recommendedTechStack.trim().toLowerCase();
    const exact = available.find((r) => r.label.trim().toLowerCase() === norm);
    if (exact) return exact.resumeId;

    const partial = available.find(
      (r) =>
        r.label.toLowerCase().includes(norm) ||
        norm.includes(r.label.trim().toLowerCase()),
    );
    if (partial) return partial.resumeId;
  }

  const concrete = available.find((r) => r.resumeId !== PROFILE_RESUME_ID);
  return concrete?.resumeId ?? available[0]?.resumeId;
}

type UseJobSkillRadarOptions = {
  /** Pre-computed vector rank from useJobResumeRank (JD open). */
  recommendedResumeId?: string;
  recommendedTechStack?: string;
};

export type JobResumeRankData = {
  recommendedResumeId: string | null;
  recommendedResumeTechStack: string | null;
  availableResumes: AvailableResume[];
};

/** Fast vector-only resume pick when opening a JD. */
export function useJobResumeRank(jobId: string | undefined, enabled: boolean) {
  const { get } = useApi(API_BASE);
  const { applier } = useApplier();
  const [data, setData] = useState<JobResumeRankData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !jobId || !applier?.name) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const params = new URLSearchParams({
          applierName: applier.name,
          rankOnly: "true",
        });
        const res = (await get(`/jobs/${jobId}/skill-radar?${params}`)) as RadarResponse;
        if (cancelled || !res?.success) return;
        setData({
          recommendedResumeId: res.recommendedResumeId ?? null,
          recommendedResumeTechStack: res.recommendedResumeTechStack ?? null,
          availableResumes: res.availableResumes ?? [],
        });
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, jobId, applier?.name, get]);

  return { data, loading };
}

export function useJobSkillRadar(
  jobId: string | undefined,
  enabled: boolean,
  options: UseJobSkillRadarOptions = {},
) {
  const { recommendedResumeId, recommendedTechStack } = options;
  const { get } = useApi(API_BASE);
  const { applier } = useApplier();
  const [data, setData] = useState<JobSkillRadarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | undefined>();
  const resumeIdRef = useRef<string | undefined>();
  const jobIdRef = useRef<string | undefined>();

  const resolvedRecommendedId = useCallback(
    (available: AvailableResume[]) =>
      resolveRecommendedResumeId(available, recommendedResumeId, recommendedTechStack) ?? null,
    [recommendedResumeId, recommendedTechStack],
  );

  const fetchRadar = useCallback(
    async (resumeId?: string) => {
      if (!jobId || !applier?.name) return;

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ applierName: applier.name });
        const rid = resumeId ?? resumeIdRef.current;
        if (rid) params.set("resumeId", rid);
        if (recommendedResumeId) params.set("recommendedResumeId", recommendedResumeId);
        if (recommendedTechStack) params.set("recommendedTechStack", recommendedTechStack);

        const res = (await get(`/jobs/${jobId}/skill-radar?${params}`)) as RadarResponse;
        if (res?.success) {
          const available = res.availableResumes ?? [];
          const recommended =
            res.recommendedResumeId ??
            resolvedRecommendedId(available);
          const activeId = res.resumeId ?? rid ?? recommended ?? undefined;

          setData({
            resumeId: activeId ?? null,
            resumeLabel: res.resumeLabel ?? "",
            axes: res.axes ?? [],
            summary: res.summary ?? { direct: 0, graph: 0, missing: 0 },
            availableResumes: available,
            recommendedResumeId: recommended,
            recommendedResumeTechStack: res.recommendedResumeTechStack ?? null,
            skillAnalysisStatus: res.skillAnalysisStatus,
          });

          if (activeId) {
            setSelectedResumeId(activeId);
            resumeIdRef.current = activeId;
          }
        } else {
          setError(res?.error || "Failed to load skill match");
          setData(null);
        }
      } catch {
        setError("Failed to load skill match");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [get, jobId, applier?.name, recommendedResumeId, recommendedTechStack, resolvedRecommendedId],
  );

  useEffect(() => {
    if (!enabled || !jobId || !applier?.name) {
      setData(null);
      setError(null);
      return;
    }

    if (jobIdRef.current !== jobId) {
      jobIdRef.current = jobId;
      resumeIdRef.current = undefined;
      setSelectedResumeId(undefined);
    }

    void fetchRadar(resumeIdRef.current);
  }, [enabled, jobId, applier?.name, fetchRadar]);

  const changeResume = useCallback((resumeId: string) => {
    resumeIdRef.current = resumeId;
    setSelectedResumeId(resumeId);
    void fetchRadar(resumeId);
  }, [fetchRadar]);

  return {
    data,
    loading,
    error,
    selectedResumeId,
    changeResume,
    refetch: fetchRadar,
  };
}

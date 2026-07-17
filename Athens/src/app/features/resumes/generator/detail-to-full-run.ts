import type { HistoryRunDetail } from "../../../services/resumeApi";
import type { FullRun } from "./history/history-types";

/** Map Athens resume API detail into FoxHire generator history shape. */
export function detailToFullRun(detail: HistoryRunDetail): FullRun {
  const config = {
    ...(detail.config ?? {}),
    templateId: detail.templateId ?? (detail.config?.templateId as string | undefined),
    jobDescription: detail.jobDescription,
    provider: detail.provider,
    model: detail.model,
  };
  return {
    _id: detail.id,
    status: detail.status,
    provider: detail.provider,
    model: detail.model,
    jobDescription: detail.jobDescription,
    usage: detail.usage as FullRun["usage"],
    config,
    sections: detail.sections,
    identity: detail.identity ?? null,
    skillProfile: detail.skillProfile,
    techStack: detail.techStack,
    analyzed: detail.analyzed,
    analyzedAt: detail.analyzedAt,
    skillAnalysisError: detail.skillAnalysisError ?? null,
  };
}

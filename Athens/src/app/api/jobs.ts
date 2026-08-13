import { API_BASE } from "@/lib/api-base";
import { streamSSE } from "../features/resumes/lib/sse";
import type { BackgroundTask } from "./backgroundTasks";

export type JobApiStatus = "Applied" | "Scheduled" | "Declined";

export const JOB_STATUS_TO_API: Record<"applied" | "scheduled" | "declined", JobApiStatus> = {
  applied: "Applied",
  scheduled: "Scheduled",
  declined: "Declined",
};

type JobMutationResponse = {
  success?: boolean;
  error?: string;
  data?: Record<string, unknown>;
  message?: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function applyToJob(jobId: string, applierName: string): Promise<JobMutationResponse> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson(res);
}

export async function updateJobStatus(
  jobId: string,
  applierName: string,
  status: JobApiStatus,
): Promise<JobMutationResponse> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, status }),
  });
  return parseJson(res);
}

export async function unapplyFromJob(jobId: string, applierName: string): Promise<JobMutationResponse> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/unapply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson(res);
}

/** Permanently delete exact documents from catalog `jobs`. */
export async function removeJobs(
  ids: string[],
): Promise<{
  success?: boolean;
  deletedCount?: number;
  deletedIds?: string[];
  removedCount?: number;
  removedIds?: string[];
  alreadyAbsentCount?: number;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/jobs/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return parseJson(res);
}

/** Mark every other New role at a company as applied, keeping the given job ids. */
export async function applyOtherCompanyJobs(
  companyId: string,
  keepJobIds: string[],
  applierName: string,
): Promise<{ success?: boolean; appliedCount?: number; appliedIds?: string[]; error?: string }> {
  const res = await fetch(`${API_BASE}/jobs/company/apply-others`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, keepJobIds, applierName }),
  });
  return parseJson(res);
}

/** Permanently delete every role for a company except the active role. */
export async function removeOtherCompanyJobs(
  companyId: string,
  keepJobId: string,
  taskProfileId?: string,
): Promise<{ success?: boolean; deletedCount?: number; deletedIds?: string[]; task?: BackgroundTask; error?: string }> {
  const res = await fetch(`${API_BASE}/jobs/company/remove-others`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      keepJobId,
      ...(taskProfileId ? { profileId: taskProfileId } : {}),
    }),
  });
  return parseJson(res);
}

/** Fetch a job's full detail (incl. description) by document id. Returns "" if unavailable. */
export async function fetchJobDescription(
  jobId: string,
  signal?: AbortSignal,
  applierName?: string,
): Promise<string> {
  try {
    const qs = applierName
      ? `?applierName=${encodeURIComponent(applierName)}`
      : "";
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}${qs}`, { signal });
    if (!res.ok) return "";
    const data = (await res.json()) as { data?: { description?: string; jobDescription?: string } };
    return String(data.data?.description ?? data.data?.jobDescription ?? "").trim();
  } catch {
    return "";
  }
}

/** Which of these jobs already have a generated résumé for this applier. */
export async function fetchJobsWithGeneratedResumes(
  applierName: string,
  jobIds: string[],
): Promise<Set<string>> {
  if (!applierName || jobIds.length === 0) return new Set();
  try {
    const res = await fetch(`${API_BASE}/personal/agent-job-resumes/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applierName, jobIds }),
    });
    if (!res.ok) return new Set();
    const data = (await res.json()) as { success?: boolean; jobIds?: string[] };
    return new Set(data.success && Array.isArray(data.jobIds) ? data.jobIds : []);
  } catch {
    return new Set();
  }
}

export type DeleteJobsGeneratedResumesResult = {
  success: boolean;
  deletedJobIds: string[];
  failedJobIds: string[];
  generationsDeleted: number;
  resumesDeleted: number;
  error?: string;
};

export type DeleteJobsGeneratedResumesProgress = {
  phase: "start" | "removing" | "finalizing" | "done";
  done: number;
  total: number;
  active: number;
  failed: number;
};

/** Remove generated résumés for the given jobs (not the jobs themselves). */
export async function deleteJobsGeneratedResumes(
  applierName: string,
  jobIds: string[],
  onProgress?: (progress: DeleteJobsGeneratedResumesProgress) => void,
  signal?: AbortSignal,
): Promise<DeleteJobsGeneratedResumesResult> {
  if (!applierName || jobIds.length === 0) {
    return {
      success: true,
      deletedJobIds: [],
      failedJobIds: [],
      generationsDeleted: 0,
      resumesDeleted: 0,
    };
  }

  let donePayload: Record<string, unknown> | null = null;
  let streamError: string | null = null;
  await streamSSE(
    `${API_BASE}/personal/agent-job-resumes/delete/stream`,
    { applierName, jobIds },
    (event, data) => {
      if (event === "progress") {
        onProgress?.({
          phase: String(data.phase ?? "removing") as DeleteJobsGeneratedResumesProgress["phase"],
          done: Number(data.done ?? 0),
          total: Number(data.total ?? jobIds.length),
          active: Number(data.active ?? 0),
          failed: Number(data.failed ?? 0),
        });
      } else if (event === "done") {
        donePayload = data;
      } else if (event === "error") {
        streamError = String(data.error ?? "Failed to remove generated résumés");
      }
    },
    signal,
  );

  if (streamError) throw new Error(streamError);
  const result = donePayload as Record<string, unknown> | null;
  if (!result || !result.success) throw new Error("Removal ended without a result");
  return {
    success: true,
    deletedJobIds: Array.isArray(result.deletedJobIds)
      ? result.deletedJobIds.map(String)
      : [],
    failedJobIds: Array.isArray(result.failedJobIds)
      ? result.failedJobIds.map(String)
      : [],
    generationsDeleted: Number(result.generationsDeleted ?? 0),
    resumesDeleted: Number(result.resumesDeleted ?? 0),
  };
}

export interface GeneratedResumeUsage {
  promptTokens: number;
  cachedTokens?: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
}

export interface GeneratedJobResume {
  /** Empty when generation used deferPdf (Job Search bulk). */
  pdfBase64: string;
  fileName: string;
  mimeType: string;
  reused: boolean;
  generationId: string | null;
  resumePdfPath?: string | null;
  model?: string | null;
  provider?: string | null;
  usage?: GeneratedResumeUsage;
}

export interface SubmissionKitResume {
  resumeId: string;
  fileName: string;
  mimeType: "application/pdf";
  contentBase64: string;
  resumePdfPath?: string | null;
  source?: string | null;
  updatedAt?: string | null;
}

export async function fetchSubmissionKitResume(
  ownerName: string,
  signal?: AbortSignal,
): Promise<SubmissionKitResume> {
  const res = await fetch(
    `${API_BASE}/personal/submission-kit-resume?ownerName=${encodeURIComponent(ownerName)}`,
    { signal },
  );
  const data = (await res.json()) as {
    success?: boolean;
    error?: string;
    resume?: SubmissionKitResume;
  };
  if (!res.ok || !data.success || !data.resume) {
    throw new Error(data.error || "Resume Generator Kit PDF is not available");
  }
  return data.resume;
}

/**
 * Load an already-generated agent draft PDF for a job (no LLM).
 * Used to hydrate Agent mode from Job Search pre-generated résumés.
 * Filename is always `{profile}.pdf` — never a job-id suffix (those used to
 * leak into Greenhouse uploads as e.g. "David Moll-6a5656e3.pdf").
 */
export async function fetchAgentJobResumePdf(
  applierName: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ fileName: string; mimeType: "application/pdf"; pdfBase64: string }> {
  const res = await fetch(
    `${API_BASE}/personal/agent-job-resume/${encodeURIComponent(jobId)}/pdf?applierName=${encodeURIComponent(applierName)}`,
    { signal },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Draft PDF unavailable (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const matched = /filename="([^"]+)"/i.exec(disposition);
  let fileName = matched?.[1] || `${applierName.replace(/[^\w.\-()+ ]+/g, "_")}.pdf`;
  // Strip legacy `-{8 hex job id}` suffix if an older server still sends it.
  fileName = fileName.replace(/-[a-f0-9]{8}(?=\.pdf$)/i, "");
  if (!fileName.toLowerCase().endsWith(".pdf")) fileName = `${fileName}.pdf`;
  return { fileName, mimeType: "application/pdf", pdfBase64: btoa(binary) };
}

export type ResumeSectionPurpose = "summary" | "skills" | "experience";

export interface ResumeGenerationProgress {
  stepLabel: string | null;
  completedSections: Partial<Record<ResumeSectionPurpose, boolean>>;
  /** SSE step index/total when available — used for bulk fractional progress. */
  stepIndex?: number;
  stepTotal?: number;
  phase?: string;
}

function parseGeneratedJobResume(
  data: Record<string, unknown>,
  applierName: string,
  options?: { allowMissingPdf?: boolean },
): GeneratedJobResume {
  if (!data.pdfBase64 && !options?.allowMissingPdf) {
    throw new Error("Résumé generated but no PDF was returned");
  }
  const fileName = (String(data.fileName || "") || `${applierName}.pdf`)
    .replace(/\.txt\.pdf$/i, ".pdf")
    .replace(/[^\w.\-()+ ]+/g, "_");
  const finalName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  const u = data.usage as
    | {
        inputTokens?: number;
        cachedTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        costUsd?: number;
        cost?: number;
      }
    | undefined;
  return {
    pdfBase64: data.pdfBase64 ? String(data.pdfBase64) : "",
    fileName: finalName,
    mimeType: "application/pdf",
    reused: Boolean(data.reused),
    generationId: (data.generationId as string | null) ?? null,
    resumePdfPath: (data.resumePdfPath as string | null) ?? null,
    model: (data.model as string | null) ?? null,
    provider: (data.provider as string | null) ?? null,
    usage: u
      ? {
          promptTokens: u.inputTokens ?? 0,
          cachedTokens: u.cachedTokens,
          completionTokens: u.outputTokens ?? 0,
          totalTokens: u.totalTokens ?? 0,
          costUsd: u.costUsd ?? u.cost,
        }
      : undefined,
  };
}

/**
 * Generate (or reuse) a per-job résumé with live SSE step progress (Editor-style).
 */
export async function generateJobResumeStream(
  params: {
    applierName: string;
    jobId: string;
    jobDescription: string;
    forceRegenerate?: boolean;
    /** Skip Chromium PDF — Job Search bulk only needs sections cached. */
    deferPdf?: boolean;
  },
  onProgress?: (progress: ResumeGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<GeneratedJobResume> {
  let donePayload: Record<string, unknown> | null = null;
  await streamSSE(
    `${API_BASE}/personal/resume-generate/for-agent-job/stream`,
    {
      applierName: params.applierName,
      jobId: params.jobId,
      jobDescription: params.jobDescription,
      ...(params.forceRegenerate ? { forceRegenerate: true } : {}),
      ...(params.deferPdf ? { deferPdf: true } : {}),
    },
    (event, data) => {
      if (event === "step") {
        const phase = String(data.phase ?? "");
        const name = String(data.name ?? "Step");
        const purpose = data.purpose as ResumeSectionPurpose | undefined;
        const stepIndex = Number.isFinite(Number(data.index)) ? Number(data.index) : undefined;
        const stepTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : undefined;
        if (phase === "reused") {
          onProgress?.({ stepLabel: "Reusing saved draft…", completedSections: {}, phase, stepIndex, stepTotal });
          return;
        }
        if (phase === "queued") {
          onProgress?.({ stepLabel: "Waiting for generation slot…", completedSections: {}, phase, stepIndex, stepTotal });
          return;
        }
        if (phase === "rendering-pdf") {
          onProgress?.({ stepLabel: "Rendering PDF…", completedSections: {}, phase, stepIndex, stepTotal });
          return;
        }
        if (phase === "step-start") {
          onProgress?.({
            stepLabel: `Running: ${name}…`,
            completedSections: {},
            phase,
            stepIndex,
            stepTotal,
          });
          return;
        }
        if (phase === "step-done") {
          const completedSections: Partial<Record<ResumeSectionPurpose, boolean>> = {};
          if (purpose === "summary" || purpose === "skills" || purpose === "experience") {
            completedSections[purpose] = true;
          }
          onProgress?.({
            stepLabel: `${name} generated`,
            completedSections,
            phase,
            stepIndex,
            stepTotal,
          });
        }
      }
      if (event === "done") donePayload = data;
      if (event === "error") throw new Error(String(data.error ?? "Résumé generation failed"));
    },
    signal,
  );
  if (!donePayload) throw new Error("Résumé generation ended without a result");
  return parseGeneratedJobResume(donePayload, params.applierName, {
    allowMissingPdf: Boolean(params.deferPdf),
  });
}

/**
 * Generate (or reuse) a per-job résumé tailored to the JD, using the profile's
 * saved Resume Generator config. Only jobDescription varies per job.
 * Throws on failure — callers must abort apply (no bundled fallback).
 */
export async function generateJobResume(params: {
  applierName: string;
  jobId: string;
  jobDescription: string;
  forceRegenerate?: boolean;
}): Promise<GeneratedJobResume> {
  const res = await fetch(`${API_BASE}/personal/resume-generate/for-agent-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applierName: params.applierName,
      jobId: params.jobId,
      jobDescription: params.jobDescription,
      ...(params.forceRegenerate ? { forceRegenerate: true } : {}),
    }),
  });
  const data = (await res.json()) as Record<string, unknown> & { success?: boolean; error?: string };
  if (!res.ok || !data.success) throw new Error(data.error || `Résumé generation failed (${res.status})`);
  return parseGeneratedJobResume(data, params.applierName);
}

export type RecommendResumeResultRow = {
  jobId: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  recommendedResumeStack?: string | null;
  recommendedResumeId?: string | null;
  recommendedResumeReason?: string | null;
  warning?: string | null;
  mode?: string | null;
  useCustomizedResume?: boolean;
};

export type RecommendResumesResponse = {
  success?: boolean;
  error?: string;
  total?: number;
  succeeded?: number;
  skipped?: number;
  failed?: number;
  replaceExisting?: boolean;
  results?: RecommendResumeResultRow[];
};

/** Recommend Library resume stacks for Bid Ready or Worker pool jobs from stored JDs. */
export async function recommendResumesFromLibrary(params: {
  applierName: string;
  jobIds: string[];
  /** When false, skip LLM for jobs that already have a recommendation. Default true. */
  replaceExisting?: boolean;
}): Promise<RecommendResumesResponse> {
  const res = await fetch(`${API_BASE}/jobs/recommend-resumes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applierName: params.applierName,
      jobIds: params.jobIds,
      replaceExisting: params.replaceExisting !== false,
    }),
  });
  return parseJson(res);
}

export type SetRecommendedResumeResponse = {
  success?: boolean;
  error?: string;
  jobId?: string;
  recommendedResumeStack?: string | null;
  recommendedResumeId?: string | null;
  recommendedResumeReason?: string | null;
  useCustomizedResume?: boolean;
  recommendWarning?: string | null;
  recommendedAt?: string | null;
  recommendMode?: "manual" | string | null;
};

/** Manually assign a Library resume stack to a Bid Ready or Worker pool job. */
export async function setRecommendedResumeFromLibrary(params: {
  applierName: string;
  jobId: string;
  resumeId: string;
}): Promise<SetRecommendedResumeResponse> {
  const res = await fetch(`${API_BASE}/jobs/set-recommended-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applierName: params.applierName,
      jobId: params.jobId,
      resumeId: params.resumeId,
    }),
  });
  return parseJson(res);
}

import { API_BASE } from "@/lib/api-base";
import { streamSSE } from "../features/resumes/lib/sse";

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

/** Permanently delete jobs from the database. */
export async function removeJobs(ids: string[]): Promise<{ success?: boolean; deletedCount?: number; error?: string }> {
  const res = await fetch(`${API_BASE}/jobs/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return parseJson(res);
}

/** Fetch a job's full detail (incl. description) by Mongo id. Returns "" if unavailable. */
export async function fetchJobDescription(jobId: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, { signal });
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

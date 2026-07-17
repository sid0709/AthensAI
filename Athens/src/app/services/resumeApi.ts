import { API_BASE } from "@/lib/api-base";
import type {
  EditorDraft,
  GeneratorIdentity,
  HistoryRunDetail,
  HistoryRunSummary,
  ResumeSkillEntry,
  ResumeStackCatalog,
  UserResumeDetail,
  UserResumeSummary,
} from "../types/resume";

const base = () => API_BASE.replace(/\/$/, "");

async function parseJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${base()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, init);
  const data = (await parseJson(res)) as T & { success?: boolean; error?: string };
  if (!res.ok || data?.success === false) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data;
}

// --- User uploaded resumes ---

export async function fetchUserResumes(ownerName: string, source?: "uploaded" | "generated"): Promise<UserResumeSummary[]> {
  const params = new URLSearchParams({ ownerName });
  if (source) params.set("source", source);
  const data = await apiFetch<{ resumes: UserResumeSummary[] }>(
    `/personal/user-resumes?${params.toString()}`,
  );
  return data.resumes ?? [];
}

export async function fetchUserResume(id: string, ownerName: string): Promise<UserResumeDetail> {
  const data = await apiFetch<{ resume: UserResumeDetail }>(
    `/personal/user-resumes/${encodeURIComponent(id)}?ownerName=${encodeURIComponent(ownerName)}`,
  );
  return data.resume;
}

export async function uploadUserResume(payload: {
  ownerName: string;
  ownerId: string;
  techStack: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
}): Promise<UserResumeSummary> {
  const data = await apiFetch<{ resume: UserResumeSummary }>("/personal/user-resumes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.resume;
}

export async function bulkUploadUserResumes(payload: {
  ownerName: string;
  ownerId: string;
  items: Omit<Parameters<typeof uploadUserResume>[0], "ownerName" | "ownerId">[];
}): Promise<{ ok: UserResumeSummary[]; failed: { fileName: string; error: string }[] }> {
  const data = await apiFetch<{ ok: UserResumeSummary[]; failed: { fileName: string; error: string }[] }>(
    "/personal/user-resumes/bulk",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return { ok: data.ok ?? [], failed: data.failed ?? [] };
}

export async function setPrimaryUserResume(id: string, ownerName: string): Promise<UserResumeSummary> {
  const data = await apiFetch<{ resume: UserResumeSummary }>(
    `/personal/user-resumes/${encodeURIComponent(id)}/primary`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerName }),
    },
  );
  return data.resume;
}

export async function deleteUserResume(id: string, ownerName: string): Promise<void> {
  await apiFetch(`/personal/user-resumes/${encodeURIComponent(id)}?ownerName=${encodeURIComponent(ownerName)}`, {
    method: "DELETE",
  });
}

export type ResumeSkillAnalysisResult = {
  alreadyAnalyzed?: boolean;
  skillProfile: ResumeSkillEntry[];
  graph?: unknown;
  profileGraph?: unknown;
  usage?: unknown;
  provider?: string;
  model?: string;
};

export async function analyzeUserResume(
  ownerName: string,
  resumeId: string,
  options?: { force?: boolean },
): Promise<ResumeSkillAnalysisResult> {
  const data = await apiFetch<ResumeSkillAnalysisResult>(
    `/personal/user-resumes/${encodeURIComponent(resumeId)}/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerName, force: Boolean(options?.force) }),
    },
  );
  return data;
}

export async function clearUserResumeAnalysis(
  ownerName: string,
  resumeId: string,
): Promise<UserResumeSummary> {
  const data = await apiFetch<{ resume: UserResumeSummary }>(
    `/personal/user-resumes/${encodeURIComponent(resumeId)}/clear-analysis`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerName }),
    },
  );
  return data.resume;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Resume catalog (stack JSON) ---

export async function fetchResumeCatalog(applierName: string): Promise<{
  catalog: ResumeStackCatalog;
  updatedAt: string | null;
}> {
  const data = await apiFetch<{ catalog: ResumeStackCatalog; updatedAt?: string | null }>(
    `/personal/resume-catalog?applierName=${encodeURIComponent(applierName)}`,
  );
  return { catalog: data.catalog ?? {}, updatedAt: data.updatedAt ?? null };
}

export async function saveResumeCatalog(applierName: string, catalog: ResumeStackCatalog): Promise<void> {
  await apiFetch("/personal/resume-catalog", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, catalog }),
  });
}

export async function validateResumeCatalogApi(catalog: unknown): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
  catalog?: ResumeStackCatalog;
}> {
  const data = await apiFetch<{
    valid: boolean;
    errors?: string[];
    warnings?: string[];
    catalog?: ResumeStackCatalog;
  }>("/personal/resume-catalog/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalog }),
  });
  return {
    valid: Boolean(data.valid),
    errors: data.errors ?? [],
    warnings: data.warnings ?? [],
    catalog: data.catalog,
  };
}

// --- Generator config ---

export async function fetchGeneratorConfig(applierName: string): Promise<Partial<EditorDraft> | null> {
  const data = await apiFetch<{ config: Partial<EditorDraft> | null }>(
    `/personal/resume-generator/config?applierName=${encodeURIComponent(applierName)}`,
  );
  return data.config ?? null;
}

export async function saveGeneratorConfig(applierName: string, config: Partial<EditorDraft>): Promise<void> {
  await apiFetch("/personal/resume-generator/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, config }),
  });
}

// --- LLM models ---

export async function fetchLlmModels(provider: string, applierName: string): Promise<string[]> {
  const data = await apiFetch<{ models?: string[] }>(
    `/personal/llm-models?provider=${encodeURIComponent(provider)}&applierName=${encodeURIComponent(applierName)}`,
  );
  return data.models ?? [];
}

// --- Generation history ---

export type HistoryQuery = {
  applierName: string;
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  model?: string;
  provider?: string;
  templateId?: string;
  sort?: string;
};

export async function fetchGenerationHistory(query: HistoryQuery): Promise<{
  runs: HistoryRunSummary[];
  total: number;
  facets?: { models?: string[]; providers?: string[]; templates?: string[] };
}> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  });
  params.set("includeFacets", "1");
  const url = `${base()}/personal/resume-generations?${params.toString()}`;
  const res = await fetch(url);
  const data = (await parseJson(res)) as {
    success?: boolean;
    runs?: Record<string, unknown>[];
    total?: number;
    facets?: { models?: string[]; providers?: string[]; templates?: string[] };
  } | null;

  if (!res.ok) {
    return { runs: [], total: 0, facets: {} };
  }

  const runs: HistoryRunSummary[] = (data?.runs ?? []).map((r) => {
    const usage = (r.usage ?? {}) as { totalTokens?: number; cost?: number };
    const config = (r.config ?? {}) as { templateId?: string };
    const started = (r.startedAt ?? r.createdAt ?? "") as string;
    return {
      id: String(r._id ?? r.id ?? ""),
      status: (r.status as HistoryRunSummary["status"]) ?? "completed",
      createdAt: typeof started === "string" ? started : new Date(started as Date).toISOString(),
      jobTitle: undefined,
      jobDescription: String(r.jobDescription ?? ""),
      model: String(r.model ?? ""),
      provider: String(r.provider ?? ""),
      templateId: config.templateId,
      techStack: typeof r.techStack === "string" ? r.techStack : undefined,
      tokens: usage.totalTokens ?? 0,
      costUsd: usage.cost ?? 0,
    };
  });

  return {
    runs,
    total: data?.total ?? 0,
    facets: data?.facets,
  };
}

export async function deleteGenerationRun(id: string, applierName: string): Promise<{ deleted: boolean; generationId: string; resumeDeleted?: boolean }> {
  await apiFetch(
    `/personal/resume-generations/${encodeURIComponent(id)}?applierName=${encodeURIComponent(applierName)}`,
    { method: "DELETE" },
  );
  return { deleted: true, generationId: id };
}

/** Render a stored generation to PDF and trigger a browser download. */
export async function downloadGenerationPdf(id: string, fallbackName = "Resume.pdf"): Promise<void> {
  const res = await fetch(
    `${base()}/personal/resume-generations/${encodeURIComponent(id)}/pdf?download=1`,
  );
  if (!res.ok) {
    const data = (await parseJson(res)) as { error?: string } | null;
    throw new Error(data?.error || `PDF download failed (${res.status})`);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const matched = /filename="([^"]+)"/i.exec(disposition);
  let fileName = matched?.[1] || fallbackName;
  if (!fileName.toLowerCase().endsWith(".pdf")) fileName = `${fileName}.pdf`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchGenerationDetail(id: string, applierName: string): Promise<HistoryRunDetail> {
  const data = await apiFetch<{ run: Record<string, unknown> }>(
    `/personal/resume-generations/${encodeURIComponent(id)}?applierName=${encodeURIComponent(applierName)}`,
  );
  const r = data.run;
  const usage = (r.usage ?? {}) as { totalTokens?: number; cost?: number };
  const config = (r.config ?? {}) as Record<string, unknown>;
  const started = (r.startedAt ?? r.createdAt ?? "") as string;
  return {
    id: String(r._id ?? r.id ?? id),
    status: (r.status as HistoryRunDetail["status"]) ?? "completed",
    createdAt: typeof started === "string" ? started : new Date(started as Date).toISOString(),
    jobDescription: String(r.jobDescription ?? ""),
    model: String(r.model ?? ""),
    provider: String(r.provider ?? ""),
    templateId: (config.templateId as string) ?? undefined,
    techStack: typeof r.techStack === "string" ? r.techStack : undefined,
    tokens: usage.totalTokens ?? 0,
    costUsd: usage.cost ?? 0,
    sections: r.sections as Record<string, unknown>,
    config,
    identity: r.identity as GeneratorIdentity,
    perStep: r.perStep as unknown[],
    usage,
    skillProfile: Array.isArray(r.skillProfile) ? (r.skillProfile as HistoryRunDetail["skillProfile"]) : undefined,
    analyzed: Boolean(r.analyzed),
    analyzedAt: typeof r.analyzedAt === "string" ? r.analyzedAt : undefined,
    skillAnalysisError: typeof r.skillAnalysisError === "string" ? r.skillAnalysisError : null,
  };
}

// --- Resume analysis ---

export type ResumeAnalysisResult = {
  skillProfileText: string;
  rankedStacks: { name: string; score: number }[];
  rankedUploads: { id: string; fileName: string; techStack: string; score: number }[];
  usage?: unknown;
  provider?: string;
  model?: string;
};

export async function analyzeResumeMatch(
  applierName: string,
  jobDescription: string,
  topN = 5,
): Promise<ResumeAnalysisResult> {
  const data = await apiFetch<ResumeAnalysisResult>("/personal/resume-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, jobDescription, topN }),
  });
  return data;
}

export type { GeneratorIdentity, ResumeSkillEntry };

// --- Uploaded resume templates ---

export type ResumeTemplateSlot = {
  index: number;
  paragraphIndex: number;
  section: "summary" | "skills" | "experience";
  companyHint?: string;
  isBullet: boolean;
  experienceIndex?: number;
};

export type UploadedResumeTemplate = {
  id: string;
  name: string;
  source: "uploaded";
  format: "docx";
  fileName?: string;
  slotCount: number;
  sectionsFound: ("summary" | "skills" | "experience")[];
  slots: ResumeTemplateSlot[];
  warnings: string[];
  uploadedAt?: string;
};

export async function fetchResumeTemplates(ownerName: string): Promise<UploadedResumeTemplate[]> {
  const data = await apiFetch<{ templates: UploadedResumeTemplate[] }>(
    `/personal/resume-templates?ownerName=${encodeURIComponent(ownerName)}`,
  );
  return data.templates ?? [];
}

export async function uploadResumeTemplate(payload: {
  ownerName: string;
  fileName: string;
  contentBase64: string;
  name?: string;
  identity?: GeneratorIdentity;
}): Promise<UploadedResumeTemplate> {
  const data = await apiFetch<{ template: UploadedResumeTemplate }>("/personal/resume-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.template;
}

export async function deleteResumeTemplate(id: string, ownerName: string): Promise<void> {
  await apiFetch(`/personal/resume-templates/${encodeURIComponent(id)}?ownerName=${encodeURIComponent(ownerName)}`, {
    method: "DELETE",
  });
}

export async function fillResumeTemplateDocx(payload: {
  templateId: string;
  ownerName: string;
  sections: Record<string, unknown>;
  fileName?: string;
}): Promise<Blob> {
  const url = `${base()}/personal/resume-template-fill`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(msg);
  }
  return res.blob();
}

export async function fetchResumeTemplatePreview(payload: {
  templateId: string;
  ownerName: string;
  sections?: Record<string, unknown>;
}): Promise<{ html: string; warnings?: string[]; templateName?: string }> {
  const data = await apiFetch<{ html: string; warnings?: string[]; templateName?: string }>(
    "/personal/resume-template-preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return { html: data.html ?? "", warnings: data.warnings, templateName: data.templateName };
}

export type ResumeTemplatePreviewPage = {
  mimeType: string;
  dataBase64: string;
  width: number;
  height: number;
};

export async function fetchResumeTemplatePreviewImages(payload: {
  templateId: string;
  ownerName: string;
  sections?: Record<string, unknown>;
}): Promise<{ pages: ResumeTemplatePreviewPage[]; warnings?: string[]; templateName?: string }> {
  const data = await apiFetch<{ pages?: ResumeTemplatePreviewPage[]; warnings?: string[]; templateName?: string }>(
    "/personal/resume-template-preview-images",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return { pages: data.pages ?? [], warnings: data.warnings, templateName: data.templateName };
}

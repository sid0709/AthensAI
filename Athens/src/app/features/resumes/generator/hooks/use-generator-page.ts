import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DropdownOption } from "../adapters/ui";
import { useNotify } from "../adapters/notify";
import { useApi } from "@/api/useApi";
import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";
import { useApplier } from "@/context/applier-context";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";
import { resolveSavedProfileAiDefault } from "@/app/data/settings/profile";
import {
  enqueueResumeGenerationRequest,
  getCompletedResumeGenerationTaskResult,
  getResumeGenerationTaskResult,
} from "@/app/api/backgroundTasks";
import { buildResumeModel } from "../build-resume-model";
import { templateById } from "../constants/templates";
import {
  defaultConfig,
  defaultPromptFor,
  FALLBACK_MODELS,
  mergeStoredConfig,
  serializeStoredConfig,
  resolveModelForProvider,
  uid,
  fontStack,
} from "../constants/defaults";
import { JOB_DESC_TOKEN } from "../constants/tokens";
import { mergeGeneratedSection, normalizeGenerated } from "../utils/content";
import { defaultCoverageDecision, defaultCoverageDecisions } from "../utils/coverage";
import { applicationDraftStorageKey, identityFromProfile, isValidJson, storageKey } from "../utils/identity";
import {
  deleteResumeTemplate,
  fetchResumeTemplates,
  fillResumeTemplateDocx,
  fileToBase64,
  uploadResumeTemplate,
} from "@/app/services/resumeApi";
import type {
  GenProgress,
  GenProgressStep,
  GeneratedContent,
  GeneratorConfig,
  GenStep,
  Identity,
  LayoutSection,
  PreviewEdit,
  Purpose,
  CoverageDecision,
  ResumeCoverageAnalysis,
  ResumeTheme,
  StepKind,
  UploadedTemplateManifest,
  UsageBreakdown,
} from "../types";
import { isUploadedTemplateId, PURPOSES, SECTION_LABEL, uploadedTemplateDocumentId } from "../types";
import { applyHistoryRun } from "./load-history-run";
import type { FullRun } from "../history/history-types";

function formatCompanyToken(c: { title?: string; company?: string; period?: string; description?: string }): string {
  const title = (c.title ?? "").trim();
  const company = (c.company ?? "").trim();
  const period = (c.period ?? "").trim();
  const description = (c.description ?? "").trim();

  let head = "";
  if (title && company) head = `${title} at ${company}`;
  else head = title || company;

  if (period && head) head = `${head} (${period})`;
  else if (period) head = period;

  return description && head ? `${head} — ${description}` : head || description;
}

function apiErrorMessage(error: unknown, fallback: string) {
  const data = error && typeof error === "object" ? (error as { data?: unknown }).data : null;
  const message = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
  return typeof message === "string" && message.trim()
    ? message
    : error instanceof Error && error.message !== "Request failed"
      ? error.message
      : fallback;
}

function coverageCareerKey(identity: Identity | null): string {
  return JSON.stringify((identity?.careers ?? []).map((career) => ({
    company: career.company,
    title: career.title,
    period: career.period,
    description: career.description,
  })));
}

function mergeGenerationStep(
  current: GenProgress | null,
  event: Record<string, unknown>,
  message?: string | null,
): GenProgress {
  const base = current ?? { steps: [], cumulative: null, done: false };
  const index = Number(event.index);
  if (!Number.isInteger(index) || index < 1) return { ...base, message: message ?? base.message };
  const phase = String(event.phase || "");
  const rawStatus = String(event.status || "");
  const status: GenProgressStep["status"] | null = phase === "step-done"
    ? "done"
    : phase === "step-start"
      ? "running"
      : rawStatus === "pending" || rawStatus === "running" || rawStatus === "done"
        ? rawStatus
        : null;
  if (!status) {
    return { ...base, message: message ?? base.message };
  }
  const previous = base.steps.find((step) => step.index === index);
  const nextStep: GenProgressStep = {
    index,
    name: String(event.name || previous?.name || `Step ${index}`),
    purpose: String(event.purpose || previous?.purpose || ""),
    kind: String(event.kind || previous?.kind || ""),
    status: previous?.status === "done" ? "done" : status,
    ...(event.usage ? { usage: event.usage as UsageBreakdown } : previous?.usage ? { usage: previous.usage } : {}),
    ...("output" in event
      ? { output: event.output }
      : previous && "output" in previous
        ? { output: previous.output }
        : {}),
  };
  const steps = [...base.steps.filter((step) => step.index !== index), nextStep]
    .sort((left, right) => left.index - right.index);
  return {
    ...base,
    steps,
    cumulative: (event.cumulative as UsageBreakdown | null) ?? base.cumulative,
    message: message ?? base.message,
  };
}

function plannedGenerationSteps(plan: Array<Pick<GenStep, "name" | "purpose" | "kind">>): GenProgressStep[] {
  return plan.map((step, offset) => ({
    index: offset + 1,
    name: step.name || `Step ${offset + 1}`,
    purpose: step.purpose,
    kind: step.kind,
    status: "pending",
  }));
}

/** Mark checklist steps done and attach per-step model outputs when available. */
function hydrateGenProgressSteps(
  plan: Array<Pick<GenStep, "name" | "purpose" | "kind">>,
  current: GenProgressStep[] | undefined,
  perStep: unknown,
): GenProgressStep[] {
  const base = (current?.length ? current : plannedGenerationSteps(plan)).map((step) => ({
    ...step,
    status: "done" as const,
  }));
  if (!Array.isArray(perStep) || !perStep.length) return base;
  let next: GenProgress = { steps: base, cumulative: null, done: true };
  for (const entry of perStep) {
    if (!entry || typeof entry !== "object") continue;
    const event = entry as Record<string, unknown>;
    next = mergeGenerationStep(next, {
      ...event,
      phase: String(event.phase || "step-done"),
      status: "done",
    });
  }
  return next.steps.map((step) => ({ ...step, status: "done" as const }));
}

export type GeneratorPageVm = ReturnType<typeof useGeneratorPage>;

export function useGeneratorPage() {
  const { get, post, put } = useApi(API_BASE);
  const { applier } = useApplier();
  const { tasks: backgroundTasks, adoptTask, cancelTask, waitForTask } = useBackgroundTasks();
  const { notify } = useNotify();

  const [config, setConfig] = useState<GeneratorConfig>(defaultConfig);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [planJson, setPlanJson] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [genProgress, setGenProgress] = useState<GenProgress | null>(null);
  const [generated, setGenerated] = useState<GeneratedContent | null>(null);
  const [coverageAnalysis, setCoverageAnalysis] = useState<ResumeCoverageAnalysis | null>(null);
  const [coverageAnalysisJd, setCoverageAnalysisJd] = useState("");
  const [coverageAnalysisCareerKey, setCoverageAnalysisCareerKey] = useState("");
  const [coverageDecisions, setCoverageDecisions] = useState<Record<string, CoverageDecision>>({});
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [analyzingCoverage, setAnalyzingCoverage] = useState(false);
  const [view, setView] = useState<"editor" | "history">("editor");
  const [editorPanel, setEditorPanel] = useState<"document" | "pipeline">("document");
  const [previewStep, setPreviewStep] = useState<number | null>(null);

  const { theme, layout, steps } = config;
  const usingUploadedTemplate = isUploadedTemplateId(config.templateId);
  const template = usingUploadedTemplate
    ? templateById("classic")
    : templateById(config.templateId);
  const [uploadedTemplates, setUploadedTemplates] = useState<UploadedTemplateManifest[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [exporting, setExporting] = useState<null | "docx">(null);

  // True once a history run has been explicitly loaded into the editor. The
  // async DB-config restore below resolves after mount, so without this guard it
  // would overwrite the just-loaded run. Reset on a genuine applier change so
  // normal config restore still works after switching accounts.
  const externalLoadRef = useRef(false);
  const restoredRevisions = useRef(new Map<string, number>());
  const terminalHandled = useRef(new Set<string>());
  const restorationInFlight = useRef(new Set<string>());
  const sessionGenerationTaskIds = useRef(new Set<string>());
  const editorGenerationTask = backgroundTasks
    .filter((candidate) => candidate.type === "resume_generation"
      && candidate.progress?.operation === "editor_generation"
      && sessionGenerationTaskIds.current.has(candidate.id))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
  const activeEditorGenerationTask = editorGenerationTask
    && ["queued", "running", "cancelling"].includes(editorGenerationTask.status)
    ? editorGenerationTask
    : null;
  const stopping = activeEditorGenerationTask?.status === "cancelling";
  // Track which applier owns the hydrated config. A boolean can remain true for
  // one render after an applier switch and persist the previous user's config.
  const configOwnerKey = applier?.name ?? "default";
  const [configHydratedFor, setConfigHydratedFor] = useState<string | null>(null);
  const configSaveRef = useRef<{
    inFlight: boolean;
    queued: { applierName: string; config: ReturnType<typeof serializeStoredConfig>; key: string } | null;
    lastSavedKey: string | null;
  }>({ inFlight: false, queued: null, lastSavedKey: null });

  const flushConfigSave = useCallback(async () => {
    const state = configSaveRef.current;
    if (state.inFlight) return;
    state.inFlight = true;
    try {
      while (state.queued) {
        const save = state.queued;
        state.queued = null;
        if (save.key === state.lastSavedKey) continue;
        try {
          await put("/personal/resume-generator/config", {
            applierName: save.applierName,
            config: save.config,
          });
          state.lastSavedKey = save.key;
        } catch {
          // Keep editing responsive. A later config change will retry with the
          // newest complete snapshot instead of replaying every intermediate one.
        }
      }
    } finally {
      state.inFlight = false;
    }
  }, [put]);

  // This preference affects server-driven Job Search and Agent runs, so flush
  // the same coalesced Mongo write path used by other ResumeConfig edits.
  const setDynamicCareerTitles = useCallback((enabled: boolean) => {
    const next = { ...config, dynamicCareerTitles: enabled };
    const stored = serializeStoredConfig(next);
    setConfig(next);
    try {
      localStorage.setItem(storageKey(applier?.name), JSON.stringify(stored));
    } catch {
      /* storage unavailable */
    }

    const applierName = applier?.name;
    if (!applierName || configHydratedFor !== configOwnerKey) return;
    const key = `${applierName}\u0000${JSON.stringify(stored)}`;
    configSaveRef.current.queued = { applierName, config: stored, key };
    void flushConfigSave();
  }, [applier?.name, config, configHydratedFor, configOwnerKey, flushConfigSave]);

  // Reference tokens a prompt can use, resolved from the JD, current Skill
  // Coverage, and profile careers. Mirrors backend substitution exactly:
  // structured Job Search / Agent runs supply fetched skills; free-text Editor
  // runs fall back to the current coverage contract.
  // Mirrors the backend substitution in resumeGenController so the chip previews
  // match what generation will actually inject. {companyN} are 1-based by role.
  const tokenValues: Record<string, string> = (() => {
    const careers = identity?.careers ?? [];
    const coverageSkills = coverageAnalysis
      && coverageAnalysis.schemaVersion === 3
      && coverageAnalysisJd === config.jobDescription
      && coverageAnalysisCareerKey === coverageCareerKey(identity)
      && config.jobDescription.trim()
      ? coverageAnalysis.skills
        .filter((skill) => (
          coverageDecisions[skill.id]
          ?? defaultCoverageDecision(skill, config.coverage.experienceRequirementThreshold)
        ) !== "exclude")
        .map((skill) => skill.name)
      : [];
    const map: Record<string, string> = {
      job_description: config.jobDescription || "",
      job_skills: coverageSkills.join(", "),
      career: careers
        .map((c) => {
          const parts = [c.title, c.company, c.period].filter(Boolean);
          const description = c.description?.trim();
          return description ? `${parts.join(" | ")} — ${description}` : parts.join(" | ");
        })
        .filter(Boolean)
        .join("\n"),
      source_resume: identity ? JSON.stringify(identity, null, 2) : "",
    };
    map.work_experience = map.career;
    careers.forEach((c, i) => {
      map[`company${i + 1}`] = formatCompanyToken(c);
    });
    // Preview chips for draft tokens stay empty until a prior step exists.
    for (const purpose of ["summary", "skills", "experience", "education", "projects"] as const) {
      map[`draft_${purpose}`] = "";
    }
    return map;
  })();
  const setTheme = (patch: Partial<ResumeTheme>) => setConfig((c) => ({ ...c, theme: { ...c.theme, ...patch } }));

  // Export the live preview to Word (DOCX only — PDF is not supported).
  const exportResume = async (format: "docx" = "docx") => {
    const fileName = `${(identity?.fullName || "resume").replace(/\s+/g, "_")}.docx`;

    if (usingUploadedTemplate) {
      if (!generated) {
        notify({ title: "Nothing to export", description: "Generate resume content first.", tone: "warning" });
        return;
      }
      const applierName = applier?.name;
      if (!applierName) {
        notify({ title: "Select an applier", description: "Choose an applier in the sidebar first.", tone: "warning" });
        return;
      }
      setExporting("docx");
      try {
        const sections = {
          summary: { summary: generated.summary },
          skills: { skills: generated.skills },
          experience: { experiences: generated.experience },
        };
        const blob = await fillResumeTemplateDocx({
          templateId: config.templateId,
          ownerName: applierName,
          sections,
          fileName,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        notify({
          title: "Export Word failed",
          description: e instanceof Error ? e.message : String(e),
          tone: "error",
        });
      } finally {
        setExporting(null);
      }
      return;
    }

    void format;
    const payload = {
      model: buildResumeModel(config, generated, identity),
      paper: theme.paper,
      marginInches: theme.margin,
      font: fontStack(theme.font),
      fileName,
    };
    setExporting("docx");
    try {
      const res = await fetch(`${API_BASE}/personal/resume-docx`, {
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
          /* non-JSON error body */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify({
        title: "Export Word failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setExporting(null);
    }
  };
  // Selecting a template applies its default header alignment plus any preset
  // theme tokens it ships with (font/accent) — e.g. Modern switches to a sans
  // font + blue accent. Other theme tokens (sizes, colors you changed) persist.
  const selectTemplate = (id: string) =>
    setConfig((c) => {
      const t = templateById(id);
      const nextAccent = t.defaults?.accent ?? c.theme.accent;
      return {
        ...c,
        templateId: id,
        uploadedTemplate: undefined,
        theme: {
          ...c.theme,
          headerAlign: t.defaultHeaderAlign,
          font: t.defaults?.font ?? c.theme.font,
          accent: nextAccent,
        },
        layout: c.layout.map((s) => (s.titleColor === c.theme.accent ? { ...s, titleColor: nextAccent } : s)),
      };
    });

  const selectUploadedTemplate = (manifest: UploadedTemplateManifest) =>
    setConfig((c) => ({
      ...c,
      templateId: `upload:${manifest.id}`,
      uploadedTemplate: manifest,
    }));

  const refreshUploadedTemplates = useCallback(async () => {
    const applierName = applier?.name;
    if (!applierName) {
      setUploadedTemplates([]);
      return;
    }
    setTemplatesLoading(true);
    try {
      const templates = await fetchResumeTemplates(applierName);
      setUploadedTemplates(templates);
      setConfig((c) => {
        if (!isUploadedTemplateId(c.templateId)) return c;
        const id = uploadedTemplateDocumentId(c.templateId);
        const match = templates.find((t) => t.id === id);
        return match ? { ...c, uploadedTemplate: match } : c;
      });
    } catch {
      setUploadedTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [applier?.name]);

  const uploadTemplateFile = async (file: File) => {
    const applierName = applier?.name;
    if (!applierName) {
      notify({ title: "Select an applier", description: "Choose an applier in the sidebar first.", tone: "warning" });
      return;
    }
    if (!/\.docx$/i.test(file.name)) {
      notify({ title: "DOCX only", description: "Upload a Word .docx template with {} placeholders.", tone: "warning" });
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const template = await uploadResumeTemplate({
        ownerName: applierName,
        fileName: file.name,
        contentBase64,
        identity: identity ?? undefined,
      });
      setUploadedTemplates((prev) => [template, ...prev.filter((t) => t.id !== template.id)]);
      selectUploadedTemplate(template);
      if (template.warnings?.length) {
        notify({
          title: "Template uploaded with warnings",
          description: template.warnings.slice(0, 2).join(" "),
          tone: "warning",
        });
      } else {
        notify({
          title: "Template uploaded",
          description: `${template.slotCount} placeholder(s) found.`,
          tone: "success",
        });
      }
    } catch (e) {
      notify({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    }
  };

  const removeUploadedTemplate = async (id: string) => {
    const applierName = applier?.name;
    if (!applierName) return;
    try {
      await deleteResumeTemplate(id, applierName);
      setUploadedTemplates((prev) => prev.filter((t) => t.id !== id));
      setConfig((c) => (c.templateId === `upload:${id}` ? { ...c, templateId: "classic", uploadedTemplate: undefined } : c));
      notify({ title: "Template deleted", tone: "success" });
    } catch (e) {
      notify({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    }
  };

  // Restore saved config: localStorage first, then Firestore (authoritative).
  useEffect(() => {
    externalLoadRef.current = false;
    sessionGenerationTaskIds.current.clear();
    restoredRevisions.current.clear();
    terminalHandled.current.clear();
    restorationInFlight.current.clear();
    setConfigHydratedFor(null);
    configSaveRef.current.queued = null;
    configSaveRef.current.lastSavedKey = null;
    setGenerated(null);
    setUsage(null);
    setGenProgress(null);
    setGenerating(false);
    setCoverageAnalysis(null);
    setCoverageAnalysisJd("");
    setCoverageAnalysisCareerKey("");
    setCoverageDecisions({});

    let cancelled = false;
    let next = defaultConfig();
    try {
      const raw = localStorage.getItem(storageKey(applier?.name));
      if (raw) next = mergeStoredConfig(JSON.parse(raw) as Partial<GeneratorConfig>);
    } catch {
      next = defaultConfig();
    }
    // Application-run data is intentionally ephemeral. Clear the legacy local
    // draft so a refresh starts with only Profile and ResumeConfig, as defined
    // by the repository state-boundary rule.
    try {
      localStorage.removeItem(applicationDraftStorageKey(applier?.name));
    } catch {
      /* storage unavailable */
    }
    next = { ...next, jobDescription: "" };
    if (!cancelled) setConfig(next);

    const applierName = applier?.name;
    const finishHydration = () => {
      if (!cancelled) setConfigHydratedFor(applierName ?? "default");
    };

    if (!applierName) {
      finishHydration();
      return () => {
        cancelled = true;
      };
    }

    void retryTransient(
      () => get(
        `/personal/resume-generator/config?applierName=${encodeURIComponent(applierName)}`,
      ) as Promise<{
        success?: boolean;
        config?: unknown;
        legacyJobDescription?: string | null;
      }>,
    )
      .then((raw) => {
        const dbConfig = raw?.config;
        if (raw?.success === false) throw new Error("Could not load the saved Resume Generator configuration.");
        if (cancelled || externalLoadRef.current || !dbConfig || typeof dbConfig !== "object") return;
        const restored = {
          ...mergeStoredConfig(dbConfig),
          jobDescription: "",
        };
        const stored = serializeStoredConfig(restored);
        configSaveRef.current.lastSavedKey = `${applierName}\u0000${JSON.stringify(stored)}`;
        setConfig(restored);
      })
      .then(finishHydration)
      .catch((error) => {
        // A failed read must never make the temporary defaults eligible for an
        // automatic remote save; that would overwrite a migrated config.
        console.error("resume generator config load failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, [applier?.name, get]);

  useEffect(() => {
    void refreshUploadedTemplates();
  }, [refreshUploadedTemplates]);

  // Persist ResumeConfig locally and to Mongo on every change. Writes are
  // coalesced (latest snapshot wins) while a request is in flight so typing a
  // prompt does not enqueue a backlog of stale PUTs. Job description is omitted
  // by serializeStoredConfig — it is application-run state, not ResumeConfig.
  useEffect(() => {
    if (configHydratedFor !== configOwnerKey) return;
    const stored = serializeStoredConfig(config);
    try {
      localStorage.setItem(storageKey(applier?.name), JSON.stringify(stored));
    } catch {
      /* storage unavailable */
    }
    const applierName = applier?.name;
    if (!applierName) return;
    const key = `${applierName}\u0000${JSON.stringify(stored)}`;
    if (key === configSaveRef.current.lastSavedKey) return;
    configSaveRef.current.queued = { applierName, config: stored, key };
    void flushConfigSave();
  }, [config, applier?.name, configHydratedFor, configOwnerKey, flushConfigSave]);

  const loadIdentity = useCallback(async () => {
    const applierName = applier?.name;
    if (!applierName) {
      setIdentity(null);
      return;
    }
    setLoadingProfile(true);
    try {
      const profileParams = new URLSearchParams({ applierName });
      if (applier?._id != null) profileParams.set("profileId", String(applier._id));
      const raw = (await get(`/personal/auto-bid-profile?${profileParams}`)) as {
        success?: boolean;
        profile?: Record<string, unknown>;
        data?: { profile?: Record<string, unknown> };
      };
      const profile = raw?.profile ?? raw?.data?.profile;
      if (raw?.success && profile && typeof profile === "object") {
        setIdentity(identityFromProfile(profile));
        const aiDefault = resolveSavedProfileAiDefault(profile);
        if (aiDefault) {
          setConfig((current) => ({ ...current, ...aiDefault }));
        }
      } else {
        setIdentity(null);
        notify({ title: "No profile found", description: `No profile data for ${applierName}.`, tone: "warning" });
      }
    } catch {
      setIdentity(null);
      notify({ title: "Could not load profile", description: "Failed to fetch applier profile.", tone: "error" });
    } finally {
      setLoadingProfile(false);
    }
  }, [applier?._id, applier?.name, get, notify]);

  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);

  const coverageIsCurrent = Boolean(
    coverageAnalysis
    && coverageAnalysis.schemaVersion === 3
    && coverageAnalysisJd === config.jobDescription
    && coverageAnalysisCareerKey === coverageCareerKey(identity)
    && config.jobDescription.trim(),
  );
  const setCoverageDecision = useCallback((skillId: string, decision: CoverageDecision) => {
    setCoverageDecisions((current) => ({ ...current, [skillId]: decision }));
  }, []);

  const runCoverageAnalysis = useCallback(async (): Promise<ResumeCoverageAnalysis | null> => {
    const applierName = applier?.name;
    const jobDescription = config.jobDescription.trim();
    if (!applierName || !jobDescription) return null;
    setAnalyzingCoverage(true);
    try {
      const response = await post("/personal/resume-generator/analyze", {
        applierName,
        profileId: applier?._id != null ? String(applier._id) : undefined,
        jobDescription,
        identity,
        coverage: config.coverage,
      }) as {
        success?: boolean;
        analysis?: ResumeCoverageAnalysis;
      };
      if (!response?.analysis) throw new Error("Skill analysis returned no ledger.");
      const analysis = response.analysis;
      const automaticDecisions = defaultCoverageDecisions(
        analysis,
        config.coverage.experienceRequirementThreshold,
      );
      setCoverageAnalysis(analysis);
      setCoverageAnalysisJd(config.jobDescription);
      setCoverageAnalysisCareerKey(coverageCareerKey(identity));
      setCoverageDecisions(automaticDecisions);
      return analysis;
    } catch (error) {
      notify({
        title: "Skill analysis failed",
        description: apiErrorMessage(error, "Could not extract the job description's skill ledger."),
        tone: "error",
      });
      return null;
    } finally {
      setAnalyzingCoverage(false);
    }
  }, [applier?._id, applier?.name, config.coverage, config.jobDescription, identity, notify, post]);

  // Pull the provider's live model list (needs the applier's API key in profile).
  const loadModels = useCallback(
    async (force = false) => {
      const applierName = applier?.name;
      if (!applierName) {
        setModels([]);
        setModelsNote("Select an applier to load models.");
        return;
      }
      setModelsLoading(true);
      setModelsNote(null);
      try {
        const modelParams = new URLSearchParams({
          provider: config.provider,
          applierName,
        });
        if (applier?._id != null) modelParams.set("profileId", String(applier._id));
        if (force) modelParams.set("force", "1");
        const res = (await get(
          `/personal/llm-models?${modelParams}`,
        )) as { success?: boolean; models?: string[]; error?: string };
        if (res?.success && Array.isArray(res.models) && res.models.length) {
          const list = res.models;
          setModels(list);
          setModelsNote(null);
          // Self-heal: if the saved model isn't valid for this provider, pick one.
          setConfig((c) => {
            const model = list.includes(c.model) ? c.model : resolveModelForProvider(c.provider, list[0]);
            return c.model === model ? c : { ...c, model };
          });
        } else {
          setModels([]);
          setModelsNote(res?.error || "No models returned — using defaults.");
          setConfig((c) => {
            const model = resolveModelForProvider(c.provider, c.model);
            return c.model === model ? c : { ...c, model };
          });
        }
      } catch {
        setModels([]);
        setModelsNote("Could not reach the model list — using defaults.");
      } finally {
        setModelsLoading(false);
      }
    },
    [applier?._id, applier?.name, config.provider, get],
  );

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  // Available model options: live list when present, otherwise the fallback.
  const modelOptions: DropdownOption<string>[] = useMemo(() => {
    const list = models.length ? models : FALLBACK_MODELS[config.provider];
    const opts = list.map((m) => ({ value: m, label: m }));
    // Keep the currently-selected model visible even if it isn't in the list.
    if (config.model && !list.includes(config.model)) opts.unshift({ value: config.model, label: config.model });
    return opts;
  }, [models, config.provider, config.model]);

  // --- layout ops -----------------------------------------------------------
  const patchSection = (id: string, patch: Partial<LayoutSection>) =>
    setConfig((c) => ({ ...c, layout: c.layout.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const moveSection = (id: string, dir: -1 | 1) =>
    setConfig((c) => {
      const i = c.layout.findIndex((s) => s.id === id);
      const t = i + dir;
      if (i < 0 || t < 0 || t >= c.layout.length) return c;
      const layout = [...c.layout];
      [layout[i], layout[t]] = [layout[t], layout[i]];
      return { ...c, layout };
    });
  const applyPalette = (accent: string, text: string) =>
    setConfig((c) => ({
      ...c,
      theme: { ...c.theme, accent, text },
      // Recolor section titles still using the previous accent.
      layout: c.layout.map((s) => (s.titleColor === c.theme.accent ? { ...s, titleColor: accent } : s)),
    }));

  // --- step ops -------------------------------------------------------------
  const patchStep = (id: string, patch: Partial<GenStep>) =>
    setConfig((c) => ({ ...c, steps: c.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const moveStep = (id: string, dir: -1 | 1) =>
    setConfig((c) => {
      const i = c.steps.findIndex((s) => s.id === id);
      const t = i + dir;
      if (i < 0 || t < 0 || t >= c.steps.length) return c;
      const steps = [...c.steps];
      [steps[i], steps[t]] = [steps[t], steps[i]];
      return { ...c, steps };
    });
  const removeStep = (id: string) =>
    setConfig((c) => {
      const target = c.steps.find((s) => s.id === id);
      if (!target || target.kind === "final") return c; // never drop a final step
      return { ...c, steps: c.steps.filter((s) => s.id !== id) };
    });
  const addFineTune = (purpose: Purpose) => {
    const count = config.steps.filter((s) => s.purpose === purpose && s.kind === "fine-tune").length;
    setConfig((c) => ({
      ...c,
      steps: [
        ...c.steps,
        {
          id: uid(),
          purpose,
          kind: "fine-tune",
          name: `${SECTION_LABEL[purpose]} — fine-tune ${count + 1}`,
          prompt: defaultPromptFor(purpose, "fine-tune"),
          schema: "",
        },
      ],
    }));
  };

  const setIdentityField = (key: keyof Identity, value: string) =>
    setIdentity((prev) => (prev ? { ...prev, [key]: value } : prev));

  // --- validation -----------------------------------------------------------
  const validation = useMemo(() => {
    const errors: string[] = [];
    for (const p of PURPOSES) {
      const finals = steps.filter((s) => s.purpose === p && s.kind === "final");
      if (finals.length === 0) errors.push(`${SECTION_LABEL[p]} has no final prompt (exactly 1 required).`);
      else if (finals.length > 1) errors.push(`${SECTION_LABEL[p]} has ${finals.length} final prompts (exactly 1 required).`);
      for (const f of finals) if (!isValidJson(f.schema)) errors.push(`${SECTION_LABEL[p]} final schema is invalid JSON.`);
    }
    return errors;
  }, [steps]);

  const finalCountByPurpose = useMemo(() => {
    const m: Record<Purpose, number> = { summary: 0, skills: 0, experience: 0 };
    for (const s of steps) if (s.kind === "final") m[s.purpose] += 1;
    return m;
  }, [steps]);

  // Ordered AI request plan (independent of layout order).
  const plan = useMemo(
    () =>
      steps.map((s, i) => ({
        index: i + 1,
        purpose: s.purpose,
        kind: s.kind,
        name: s.name,
        prompt: s.prompt,
        ...(s.kind === "final" ? { schema: isValidJson(s.schema) ? JSON.parse(s.schema) : s.schema } : {}),
      })),
    [steps],
  );

  const requestPayload = useMemo(
    () => ({
      applierName: applier?.name ?? null,
      profileId: applier?._id != null ? String(applier._id) : null,
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      dynamicCareerTitles: config.dynamicCareerTitles,
      templateId: config.templateId,
      template: { columns: template.columns, sidebar: template.sidebar, heading: template.heading, headingAlign: template.headingAlign },
      theme: config.theme,
      layout: config.layout.map((s) => ({ type: s.type, title: s.title, titleColor: s.titleColor, titleSize: s.titleSize, bodySize: s.bodySize })),
      identity,
      systemInstruction: config.systemInstruction,
      jobDescription: config.jobDescription,
      steps: plan,
      coverage: null,
    }),
    [
      applier?._id,
      applier?.name,
      config.dynamicCareerTitles,
      config.jobDescription,
      config.layout,
      config.model,
      config.provider,
      config.reasoningEffort,
      config.systemInstruction,
      config.templateId,
      config.theme,
      identity,
      plan,
      template.columns,
      template.heading,
      template.headingAlign,
      template.sidebar,
    ],
  );

	useEffect(() => {
		if (!applier?.name) return;
		const task = editorGenerationTask;
		if (!task) return;
		const inputId = String(task.progress?.inputId || "");
		if (!inputId) return;
		const item = task.progress?.items?.[inputId];
		const active = ["queued", "running", "cancelling"].includes(task.status);
		const revision = Number(item?.stepRevision ?? 0);
		const terminal = ["completed", "completed_with_errors", "failed", "cancelled"].includes(task.status);
		const stepEvent = item?.stepEvent && typeof item.stepEvent === "object"
			? item.stepEvent as Record<string, unknown>
			: null;
		const previousRevision = restoredRevisions.current.get(task.id) ?? -1;
		const shouldReadPartial = active && revision > previousRevision;
		const shouldReadTerminal = terminal && !terminalHandled.current.has(task.id);
		if (active) {
			setGenerating(true);
			const message = String(item?.step || (task.status === "queued" ? "Queued for generation…" : "Preparing résumé generation…"));
			setGenProgress((current) => {
				let next = current || {
					steps: plannedGenerationSteps(plan),
					cumulative: null,
					done: false,
				};
				if (!next.steps.length) next = { ...next, steps: plannedGenerationSteps(plan) };
				if (Array.isArray(item?.generationSteps)) {
					for (const persistedStep of item.generationSteps) {
						if (persistedStep && typeof persistedStep === "object") {
							next = mergeGenerationStep(next, persistedStep as Record<string, unknown>, message);
						}
					}
				}
				if (shouldReadPartial && item?.stepEvent && typeof item.stepEvent === "object") {
					next = mergeGenerationStep(next, item.stepEvent as Record<string, unknown>, message);
				}
				return { ...next, done: false, message };
			});
		}
		if (!shouldReadPartial && !shouldReadTerminal) return;

		const terminalFailureMessage = shouldReadTerminal && ["failed", "completed_with_errors", "cancelled"].includes(task.status)
			? String(item?.error || task.error || (task.status === "cancelled" ? "Generation cancelled" : "The background generation did not complete."))
			: null;
		if (terminalFailureMessage) {
			setGenerating(false);
			setGenerationError(terminalFailureMessage);
			notify({
				title: task.status === "cancelled" ? "Generation cancelled" : "Generation failed",
				description: terminalFailureMessage,
				tone: task.status === "cancelled" ? "warning" : "error",
			});
		}

		const readKey = `${task.id}:${terminal ? task.status : revision}`;
		if (restorationInFlight.current.has(readKey)) return;
		restorationInFlight.current.add(readKey);
		if (shouldReadPartial) restoredRevisions.current.set(task.id, revision);
		if (shouldReadTerminal) terminalHandled.current.add(task.id);
		const expectedPartialPurpose = shouldReadPartial
			&& stepEvent?.phase === "step-done"
				&& stepEvent?.kind === "final"
			? String(stepEvent.purpose || "")
			: "";
		void retryTransient(async () => {
			const stored = await getResumeGenerationTaskResult(inputId, applier.name);
			if (
				expectedPartialPurpose
				&& !stored.result?.sections
				&& !Object.prototype.hasOwnProperty.call(stored.partialSections || {}, expectedPartialPurpose)
			) {
				throw Object.assign(new Error("Completed résumé section is not readable yet"), { status: 503 });
			}
			return stored;
		})
			.then((stored) => {
				const sections = (stored.result?.sections || stored.partialSections || {}) as Record<string, unknown>;
				if (stored.result?.sections) {
					setGenerated(normalizeGenerated(sections));
				} else if (Object.keys(sections).length) {
					setGenerated((current) => Object.entries(sections).reduce(
						(next, [purpose, output]) => mergeGeneratedSection(next, purpose, output),
						current,
					));
				}
				if (stored.result?.usage) setUsage(stored.result.usage as UsageBreakdown);
				if (shouldReadTerminal) {
					setGenerating(false);
					setGenProgress((current) => ({
						steps: hydrateGenProgressSteps(
							plan,
							current?.steps,
							(stored.result as { perStep?: unknown } | null)?.perStep
								?? item?.generationSteps,
						),
						cumulative: (stored.result?.usage as UsageBreakdown) ?? current?.cumulative ?? null,
						done: true,
						message: terminalFailureMessage,
					}));
				}
			})
			.catch(() => {
				if (shouldReadPartial && restoredRevisions.current.get(task.id) === revision) {
					restoredRevisions.current.set(task.id, previousRevision);
				}
				if (shouldReadTerminal) terminalHandled.current.delete(task.id);
			})
			.finally(() => restorationInFlight.current.delete(readKey));
	}, [applier?.name, editorGenerationTask, notify, plan]);

  // Download a full JSON trace of the generation: config, resolved prompts,
  // per-step model output + token/cost, totals, and the assembled sections.
  const handleDownloadLog = () => {
    const jd = config.jobDescription;
    const resolve = (t: string) => t.split(JOB_DESC_TOKEN).join(jd);
    const log = {
      meta: {
        generatedAt: new Date().toISOString(),
        applier: applier?.name ?? null,
        provider: config.provider,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        templateId: config.templateId,
      },
      jobDescription: jd,
      systemInstruction: { template: config.systemInstruction, resolved: resolve(config.systemInstruction) },
      steps: (genProgress?.steps ?? []).map((st) => {
        const def = config.steps[st.index - 1];
        return {
          index: st.index,
          name: st.name,
          purpose: st.purpose,
          kind: st.kind,
          prompt: def?.prompt ?? null,
          promptResolved: def ? resolve(def.prompt) : null,
          schema: def && def.kind === "final" && isValidJson(def.schema) ? JSON.parse(def.schema) : undefined,
          // Note: OpenAI/DeepSeek chat-completions do not return the model's
          // hidden reasoning, so only the final reply + token usage are logged.
          output: st.output ?? null,
          usage: st.usage ?? null,
        };
      }),
      totalUsage: usage,
      coverageAnalysis,
      coverageDecisions,
      sections: generated,
    };
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume-generation-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Inline edits from the preview (summary text / experience bullets) write back
  // into the generated content so Export PDF, the saved config, and History all
  // reflect them.
  const handlePreviewEdit = useCallback((e: PreviewEdit) => {
    setGenerated((prev) => {
      if (!prev) return prev;
      if (e.kind === "summary") return { ...prev, summary: e.text };
      const experience = (prev.experience ?? []).map((exp, i) =>
        i === e.exp ? { ...exp, bullets: exp.bullets.map((b, j) => (j === e.bullet ? e.text : b)) } : exp,
      );
      return { ...prev, experience };
    });
  }, []);

  // Load a saved history run into the editor. Pinning externalLoadRef ensures the
  // in-flight DB-config restore (started on mount) can't overwrite it afterwards.
  const applyRun = useCallback((run: FullRun, opts?: { switchView?: boolean }) => {
    externalLoadRef.current = true;
    applyHistoryRun(run, setConfig, setGenerated, setUsage, opts?.switchView === false ? undefined : setView);
    const analysis = run.coverageAnalysis ?? null;
    const contractSkills = Array.isArray(run.coverageContract?.skills)
      ? run.coverageContract.skills as Array<{ id?: unknown; decision?: unknown }>
      : [];
    const contractDecisions = Object.fromEntries(
      [
        ...contractSkills
          .filter((skill) => typeof skill.id === "string" && ["used", "familiar"].includes(String(skill.decision)))
          .map((skill) => [String(skill.id), String(skill.decision) as CoverageDecision] as const),
        ...(Array.isArray(run.coverageContract?.excluded)
          ? (run.coverageContract.excluded as Array<{ id?: unknown }>).filter((skill) => typeof skill.id === "string")
            .map((skill) => [String(skill.id), "exclude" as CoverageDecision] as const)
          : []),
      ],
    );
    setCoverageAnalysis(analysis);
    setCoverageAnalysisJd(analysis ? String(run.jobDescription ?? "") : "");
    setCoverageAnalysisCareerKey(analysis ? coverageCareerKey(identity) : "");
    setCoverageDecisions(analysis
      ? {
          ...defaultCoverageDecisions(analysis, config.coverage.experienceRequirementThreshold),
          ...contractDecisions,
        }
      : {});
  }, [config.coverage.experienceRequirementThreshold, identity]);

  const handleGenerate = async () => {
    if (!applier?.name) {
      notify({ title: "Select an applier", description: "Choose your account in the sidebar.", tone: "warning" });
      return false;
    }
    if (!config.jobDescription.trim()) {
      notify({ title: "Add a job description", description: "Paste the target role before generating.", tone: "warning" });
      return false;
    }
    if (!identity) {
      notify({ title: "Profile not loaded", description: "Load your saved career profile before generating.", tone: "warning" });
      return false;
    }
    if (validation.length > 0) {
      notify({ title: "Fix step configuration", description: validation[0], tone: "error" });
      return false;
    }

    let generationPayload = requestPayload;
    setGenerating(true);
    setUsage(null);
    setGenerated(null);
    setGenerationError(null);
    const checklist = plannedGenerationSteps(plan);
    setGenProgress({ steps: checklist, cumulative: null, done: false, message: "Submitting generation…" });
    let queuedInputId: string | null = null;
    try {
      const queued = await enqueueResumeGenerationRequest(generationPayload);
      queuedInputId = queued.inputId;
      sessionGenerationTaskIds.current.add(queued.task.id);
      adoptTask(queued.task);
      setGenProgress({
        steps: checklist,
        cumulative: null,
        done: false,
        message: "Queued for generation…",
      });
      const terminal = await waitForTask(queued.task.id);
      terminalHandled.current.add(queued.task.id);
      if (terminal.status === "failed" || terminal.status === "completed_with_errors") {
        throw new Error(terminal.error || "Resume generation failed");
      }
      if (terminal.status === "cancelled") throw new Error("Resume generation cancelled");
      const stored = await getCompletedResumeGenerationTaskResult(queued.inputId, applier.name);
      const nextUsage = (stored.result.usage as UsageBreakdown) ?? null;
      setUsage(nextUsage);
      setGenerated(normalizeGenerated(stored.result.sections as Record<string, unknown> | undefined));
      const terminalItem = terminal.progress?.items?.[queued.inputId];
      setGenProgress((current) => ({
        steps: hydrateGenProgressSteps(
          plan,
          current?.steps,
          (stored.result as { perStep?: unknown }).perStep
            ?? terminalItem?.generationSteps,
        ),
        cumulative: nextUsage,
        done: true,
        message: null,
      }));
      notify({ title: "Resume generated", description: "Structured résumé sections were generated successfully.", tone: "success" });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed — see backend logs.";
      if (queuedInputId) {
        try {
          const stored = await getResumeGenerationTaskResult(queuedInputId, applier.name);
          const sections = (stored.result?.sections || stored.partialSections || {}) as Record<string, unknown>;
          if (Object.keys(sections).length) setGenerated(normalizeGenerated(sections));
        } catch {
          // The per-task restoration effect remains the fallback for transient reads.
        }
      }
      setGenerationError(message);
      setGenProgress((current) => ({
        steps: current?.steps ?? [],
        cumulative: current?.cumulative ?? null,
        done: true,
        message,
      }));
      notify({
        title: "Generation failed",
        description: message,
        tone: "error",
      });
      return false;
    } finally {
      setGenerating(false);
    }
  };

	const handleCancelGeneration = async () => {
		if (!activeEditorGenerationTask) return;
		try {
			await cancelTask(activeEditorGenerationTask.id);
			notify({ title: "Stopping generation…", description: "No new model step will start.", tone: "warning" });
		} catch (error) {
			notify({
				title: "Could not stop generation",
				description: error instanceof Error ? error.message : "Cancellation failed.",
				tone: "error",
			});
		}
	};

  return {
    applier,
    config,
    setConfig,
    setDynamicCareerTitles,
    identity,
    setIdentity,
    loadingProfile,
    generating,
    stopping,
    planJson,
    setPlanJson,
    models,
    modelsLoading,
    modelsNote,
    usage,
    setUsage,
    genProgress,
    generated,
    setGenerated,
    coverageAnalysis,
    coverageAnalysisJd,
    coverageDecisions,
    generationError,
    coverageIsCurrent,
    analyzingCoverage,
    setCoverageDecision,
    runCoverageAnalysis,
    configHydrated: configHydratedFor === configOwnerKey,
    view,
    setView,
    editorPanel,
    setEditorPanel,
    previewStep,
    setPreviewStep,
    theme,
    layout,
    steps,
    template,
    usingUploadedTemplate,
    uploadedTemplate: config.uploadedTemplate,
    uploadedTemplates,
    templatesLoading,
    exporting,
    tokenValues,
    setTheme,
    exportResume,
    selectTemplate,
    selectUploadedTemplate,
    uploadTemplateFile,
    removeUploadedTemplate,
    refreshUploadedTemplates,
    loadIdentity,
    loadModels,
    modelOptions,
    patchSection,
    moveSection,
    applyPalette,
    patchStep,
    moveStep,
    removeStep,
    addFineTune,
    setIdentityField,
    validation,
    finalCountByPurpose,
    plan,
    requestPayload,
    handleDownloadLog,
    handlePreviewEdit,
    handleGenerate,
    handleCancelGeneration,
    applyRun,
  };
}

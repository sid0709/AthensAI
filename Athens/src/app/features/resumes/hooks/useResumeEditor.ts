import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api-base";
import { useApplier } from "@/context/applier-context";
import { createDefaultEditorDraft } from "../../../data/resumes/seedDocument";
import { fetchAutoBidProfile } from "../../../services/profileApi";
import {
  fetchGeneratorConfig,
  fetchLlmModels,
  saveGeneratorConfig,
} from "../../../services/resumeApi";
import { getEditorDraft, saveEditorDraft } from "../../../services/resumeStorage";
import type { EditorDraft, GeneratorIdentity, RefinementStep, SectionId } from "../../../types/resume";
import { buildResumeModel, exportResumeServer, fontStack } from "../lib/buildResumeModel";
import { resolveTemplateId } from "../lib/templates";
import {
  DEFAULT_SYSTEM_INSTRUCTION,
  ensureSteps,
  FALLBACK_MODELS,
  stepsToApiPayload,
} from "../lib/generatorDefaults";
import { generatorStorageKey, identityFromProfile } from "../lib/identityFromProfile";
import { sectionsToDocument } from "../lib/sectionsToDocument";
import { streamSSE } from "../lib/sse";

export function useResumeEditor() {
  const { applier, applierReady } = useApplier();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [generatorIdentity, setGeneratorIdentity] = useState<GeneratorIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateStep, setGenerateStep] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [usage, setUsage] = useState<{ totalTokens?: number; cost?: number } | null>(null);
  const [generatedSections, setGeneratedSections] = useState<Partial<Record<SectionId, boolean>>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async (next: EditorDraft) => {
    setDraft(next);
    await saveEditorDraft(next);
  }, []);

  const loadFromStorageAndConfig = useCallback(async () => {
    const stored = await getEditorDraft();
    let next: EditorDraft = {
      ...stored,
      templateId: resolveTemplateId(stored.templateId),
      theme: {
        ...stored.theme,
        marginIn: Number.isFinite(stored.theme?.marginIn) && stored.theme.marginIn > 0 ? stored.theme.marginIn : 0.6,
      },
      systemInstruction: stored.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      refinementSteps: ensureSteps(stored.refinementSteps ?? []),
    };

    if (applier?.name) {
      try {
        const dbConfig = await fetchGeneratorConfig(applier.name);
        if (dbConfig) {
          next = {
            ...next,
            ...dbConfig,
            templateId: resolveTemplateId(dbConfig.templateId ?? next.templateId),
            document: next.document,
            refinementSteps: ensureSteps(dbConfig.refinementSteps ?? next.refinementSteps),
            systemInstruction: dbConfig.systemInstruction ?? next.systemInstruction,
          };
        }
      } catch {
        /* use local */
      }
      try {
        const raw = localStorage.getItem(generatorStorageKey(applier.name));
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<EditorDraft>;
          next = {
            ...next,
            ...parsed,
            document: next.document,
            refinementSteps: ensureSteps(parsed.refinementSteps ?? next.refinementSteps),
          };
        }
      } catch {
        /* ignore */
      }
    }

    setDraft(next);
    setLoading(false);
  }, [applier?.name]);

  useEffect(() => {
    if (!applierReady) return;
    void loadFromStorageAndConfig();
  }, [applierReady, loadFromStorageAndConfig]);

  const reloadProfile = useCallback(async () => {
    if (!applier?.name) return;
    setLoadingProfile(true);
    try {
      const { profile } = await fetchAutoBidProfile(applier.name);
      const identity = identityFromProfile(profile);
      setGeneratorIdentity(identity);
      if (draft) {
        await persist({
          ...draft,
          generatorIdentity: identity,
          document: {
            ...draft.document,
            identity: {
              fullName: identity.fullName,
              location: identity.location,
              email: identity.email,
              phone: identity.phone,
              linkedin: identity.linkedin,
            },
          },
        });
      }
    } catch {
      /* profile unavailable */
    } finally {
      setLoadingProfile(false);
    }
  }, [applier?.name, draft, persist]);

  useEffect(() => {
    if (applierReady && applier?.name) void reloadProfile();
  }, [applierReady, applier?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadModels = useCallback(async () => {
    if (!applier?.name || !draft?.provider) {
      setModels([]);
      return;
    }
    try {
      const list = await fetchLlmModels(draft.provider, applier.name);
      setModels(list.length ? list : FALLBACK_MODELS[draft.provider] ?? FALLBACK_MODELS.openai);
    } catch {
      setModels(FALLBACK_MODELS[draft?.provider ?? "openai"] ?? FALLBACK_MODELS.openai);
    }
  }, [applier?.name, draft?.provider]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (!draft || !applier?.name) return;
    try {
      localStorage.setItem(generatorStorageKey(applier.name), JSON.stringify(draft));
    } catch {
      /* ignore */
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveGeneratorConfig(applier.name, draft).catch(() => undefined);
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, applier?.name]);

  const updateDraft = useCallback(
    (patch: Partial<EditorDraft>) => {
      if (!draft) return;
      void persist({ ...draft, ...patch });
    },
    [draft, persist],
  );

  const resetDraft = useCallback(async () => {
    const identity = generatorIdentity;
    const next = createDefaultEditorDraft();
    if (identity) {
      next.generatorIdentity = identity;
      next.document.identity = {
        fullName: identity.fullName,
        location: identity.location,
        email: identity.email,
        phone: identity.phone,
        linkedin: identity.linkedin,
      };
    }
    await persist(next);
  }, [generatorIdentity, persist]);

  const loadFromHistory = useCallback(
    async (config: Partial<EditorDraft>, sections?: Record<string, unknown>) => {
      const base = draft ?? createDefaultEditorDraft();
      const identity = (config.generatorIdentity as GeneratorIdentity) ?? generatorIdentity;
      let document = base.document;
      if (sections && identity) {
        document = sectionsToDocument(sections as Parameters<typeof sectionsToDocument>[0], identity, base.document);
      }
      const next: EditorDraft = {
        ...base,
        ...config,
        document,
        refinementSteps: ensureSteps(config.refinementSteps ?? base.refinementSteps),
        generatorIdentity: identity ?? base.generatorIdentity,
      };
      await persist(next);
      return next;
    },
    [draft, generatorIdentity, persist],
  );

  const generate = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!draft || !draft.jobDescription.trim() || !applier?.name) {
      return { ok: false, error: "Job description and applier are required." };
    }
    const identity = draft.generatorIdentity ?? generatorIdentity;
    if (!identity) {
      return { ok: false, error: "Load profile from Settings first." };
    }

    setGenerating(true);
    setGenerateStep("Starting generation…");
    setUsage(null);
    setGeneratedSections({});

    const payload = {
      applierName: applier.name,
      provider: draft.provider,
      model: draft.model,
      reasoningEffort: draft.reasoningEffort === "default" ? undefined : draft.reasoningEffort,
      templateId: resolveTemplateId(draft.templateId),
      template: { layout: draft.templateId },
      theme: draft.theme,
      layout: draft.sections.map((s) => ({
        type: s.id,
        titleSize: s.titleSizePt,
        bodySize: s.bodySizePt,
        titleColor: s.color,
      })),
      identity,
      systemInstruction: draft.systemInstruction,
      jobDescription: draft.jobDescription,
      steps: stepsToApiPayload(draft.refinementSteps),
    };

    try {
      let sections: Record<string, unknown> = {};
      await streamSSE(`${API_BASE.replace(/\/$/, "")}/personal/resume-generate/stream`, payload, (event, data) => {
        if (event === "step") {
          const phase = data.phase as string;
          const name = data.name as string;
          const purpose = data.purpose as SectionId | undefined;
          if (phase === "step-start") setGenerateStep(`Running: ${name}…`);
          if (phase === "step-done") {
            if (data.cumulative) setUsage(data.cumulative as { totalTokens?: number; cost?: number });
            if (purpose && data.output && (purpose === "summary" || purpose === "skills" || purpose === "experience")) {
              sections = { ...sections, [purpose]: data.output };
              setGeneratedSections((prev) => ({ ...prev, [purpose]: true }));
              const document = sectionsToDocument(
                sections as Parameters<typeof sectionsToDocument>[0],
                identity,
                draft.document,
              );
              setDraft((prev) => (prev ? { ...prev, document, generatorIdentity: identity } : prev));
            }
          }
        }
        if (event === "done") {
          sections = (data.sections as Record<string, unknown>) ?? sections;
          if (data.usage) setUsage(data.usage as { totalTokens?: number; cost?: number });
        }
        if (event === "error") {
          throw new Error(String(data.error ?? "Generation failed"));
        }
      });

      const document = sectionsToDocument(sections as Parameters<typeof sectionsToDocument>[0], identity, draft.document);
      await persist({ ...draft, document, generatorIdentity: identity, templateId: resolveTemplateId(draft.templateId) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Generation failed" };
    } finally {
      setGenerating(false);
      setGenerateStep(null);
    }
  }, [draft, applier?.name, generatorIdentity, persist]);

  const exportResume = useCallback(
    async (format: "pdf" | "docx") => {
      if (!draft) throw new Error("No draft");
      const identity = draft.generatorIdentity ?? generatorIdentity;
      const fileName = `${(identity?.fullName || "resume").replace(/\s+/g, "_")}.${format}`;

      if (format === "pdf") {
        const pageEl = document.querySelector("#resume-print-root .resume-page") as HTMLElement | null;
        if (!pageEl) throw new Error("Preview not ready");
        const fontLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          .map((l) => (l as HTMLLinkElement).href)
          .filter((h) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(h));
        await exportResumeServer(
          "pdf",
          {
            html: pageEl.innerHTML,
            paper: draft.theme.paperSize,
            marginInches: draft.theme.marginIn,
            font: fontStack(draft.theme.font),
            baseSizePt: draft.theme.bodySizePt,
            fontLinks,
            fileName,
          },
          fileName,
          API_BASE,
        );
      } else {
        await exportResumeServer(
          "docx",
          {
            model: buildResumeModel(draft, identity),
            paper: draft.theme.paperSize,
            marginInches: draft.theme.marginIn,
            font: fontStack(draft.theme.font),
            fileName,
          },
          fileName,
          API_BASE,
        );
      }
    },
    [draft, generatorIdentity],
  );

  const updateIdentity = useCallback(
    (field: keyof EditorDraft["document"]["identity"], value: string) => {
      if (!draft) return;
      void persist({
        ...draft,
        document: {
          ...draft.document,
          identity: { ...draft.document.identity, [field]: value },
        },
      });
    },
    [draft, persist],
  );

  const setRefinementSteps = useCallback(
    (steps: RefinementStep[]) => {
      if (!draft) return;
      void persist({ ...draft, refinementSteps: steps });
    },
    [draft, persist],
  );

  return {
    draft,
    loading,
    loadingProfile,
    generating,
    generateStep,
    models,
    usage,
    generatedSections,
    generatorIdentity,
    updateDraft,
    reloadProfile,
    resetDraft,
    generate,
    exportResume,
    updateIdentity,
    setRefinementSteps,
    persist,
    loadFromHistory,
  };
}

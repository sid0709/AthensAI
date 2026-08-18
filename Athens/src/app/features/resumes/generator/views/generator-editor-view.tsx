import { useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Circle,
  Coins,
  Copy,
  Eye,
  FileText,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Palette,
  Plus,
  Sparkles,
} from "lucide-react";
import { useNotify } from "../adapters/notify";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import { DesignModal } from "../components/design-modal";
import { SectionLayoutPanel, TemplatePanel, ThemePanel } from "../components/document-design-panels";
import { PreviewToolbar, type DesignPanel } from "../components/preview-toolbar";
import { SectionTitle } from "../components/editor-ui";
import { JobRefField } from "../components/job-ref-field";
import { allStepsPromptMarkdown, StepCard } from "../components/step-card";
import { ResumePreview } from "../preview/resume-preview";
import { UploadedTemplatePreview } from "../preview/uploaded-template-preview";
import { PAGE } from "../preview/utils";
import { JOB_DESC_TOKEN } from "../constants/tokens";
import { areaCls, cardCls } from "../styles";
import { fmtCost, fmtTokens, stepOutputText } from "../utils/format";
import { resolvePromptTokens } from "../utils/prompt-tokens";
import { usageTokenLabels } from "../../../../lib/runUsage";
import type { GeneratorPageVm } from "../hooks/use-generator-page";
import type { Purpose } from "../types";
import { PURPOSES, SECTION_LABEL } from "../types";

export function GeneratorEditorView({
  vm,
  systemInstructionOpen,
  onSystemInstructionOpenChange,
}: {
  vm: GeneratorPageVm;
  systemInstructionOpen?: boolean;
  onSystemInstructionOpenChange?: (open: boolean) => void;
}) {
  const { notify } = useNotify();
  const {
    applier,
    config,
    setConfig,
    setDynamicCareerTitles,
    theme,
    layout,
    steps,
    template,
    identity,
    generated,
    generating,
    genProgress,
    usage,
    validation,
    exporting,
    planJson,
    setPlanJson,
    previewStep,
    setPreviewStep,
    tokenValues,
    finalCountByPurpose,
    plan,
    requestPayload,
    setTheme,
    selectTemplate,
    selectUploadedTemplate,
    uploadTemplateFile,
    removeUploadedTemplate,
    uploadedTemplates,
    templatesLoading,
    usingUploadedTemplate,
    uploadedTemplate,
    patchSection,
    moveSection,
    applyPalette,
    patchStep,
    moveStep,
    removeStep,
    addFineTune,
    exportResume,
    handleDownloadLog,
    handlePreviewEdit,
    generationError,
  } = vm;

  const [designPanel, setDesignPanel] = useState<DesignPanel | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [internalInstructionOpen, setInternalInstructionOpen] = useState(false);
  const instructionOpen = systemInstructionOpen ?? internalInstructionOpen;
  const setInstructionOpen = onSystemInstructionOpenChange ?? setInternalInstructionOpen;
  const resolvedSystemInstruction = resolvePromptTokens(config.systemInstruction, tokenValues);
  const resolvedPlan = plan.map((step) => ({
    ...step,
    prompt: resolvePromptTokens(step.prompt, tokenValues),
  }));
  const resolvedRequestPayload = {
    ...requestPayload,
    systemInstruction: resolvedSystemInstruction,
    steps: resolvedPlan,
  };
  const openDesignPanel = (panel: DesignPanel) => setDesignPanel(panel);
  const closeDesignPanel = () => setDesignPanel(null);

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-5 items-start">
        {/* Sticky live preview */}
        <div className="xl:sticky xl:top-6 xl:self-start xl:z-10">
          <div className={cardCls}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-500 shrink-0" />
                  <h2 className="text-sm font-medium tracking-tight">Live preview</h2>
                  <span className="text-[10px] font-normal text-neutral-400 dark:text-white/40">{PAGE[theme.paper].label}</span>
                  {generated && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> AI result
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PreviewToolbar
                  activePanel={designPanel}
                  onOpenPanel={openDesignPanel}
                  showDownloadLog={Boolean(genProgress)}
                  onDownloadLog={handleDownloadLog}
                  exporting={exporting}
                  onExportDocx={() => void exportResume("docx")}
                  disableThemeLayout={usingUploadedTemplate}
                />
                {onSystemInstructionOpenChange ? null : (
                  <button
                    type="button"
                    onClick={() => setInstructionOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={instructionOpen}
                    className="athens-btn"
                  >
                    <FileText size={16} aria-hidden="true" />
                    System instruction
                  </button>
                )}
              </div>
            </div>

            {usingUploadedTemplate && uploadedTemplate && (
              <div className="mb-3 rounded-xl border border-sky-200/70 dark:border-sky-500/30 bg-sky-50/60 dark:bg-sky-500/10 px-3 py-2 text-[11px] text-sky-800 dark:text-sky-200">
                Using uploaded template <strong>{uploadedTemplate.name}</strong> ({uploadedTemplate.slotCount} placeholders).
                Preview is rendered from your DOCX template; Word export uses the same fill pipeline.
              </div>
            )}

            {usingUploadedTemplate ? (
              <UploadedTemplatePreview
                templateId={config.templateId}
                ownerName={applier?.name}
                generated={generated}
                generating={generating}
              />
            ) : (
              <ResumePreview
                template={template}
                theme={theme}
                layout={layout}
                identity={identity}
                generated={generated}
                generating={generating}
                onEdit={handlePreviewEdit}
                onTitleChange={(id, title) => patchSection(id, { title })}
              />
            )}
            <p className="text-[11px] text-neutral-400 dark:text-white/40 mt-2">
              {usingUploadedTemplate ? (
                <>
                  Preview approximates your uploaded Word layout. Export Word for the exact document.
                  {generated ? " Generate to fill {} placeholders." : " Generate to fill {} placeholders."}
                </>
              ) : (
                <>
                  Rendered at true {theme.paper === "letter" ? "Letter" : "A4"} size — export produces an exact copy.{" "}
                  {generated
                    ? "Click the summary or any bullet to edit (⌘/Ctrl+B toggles bold)."
                    : "Sample text until you Generate."}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Generation pipeline */}
        <div className="space-y-5 min-w-0">
          {genProgress && (
            <div className={cardCls}>
              <SectionTitle
                icon={Sparkles}
                right={
                  genProgress.cumulative ? (
                    <span className="text-xs tabular-nums text-neutral-500 dark:text-white/50">
                      {fmtTokens(genProgress.cumulative.totalTokens)} tok · {fmtCost(genProgress.cumulative.cost)}
                    </span>
                  ) : undefined
                }
              >
                {generationError ? "Generation failed" : genProgress.done ? "Generation complete" : "Generating…"}
              </SectionTitle>
              {generationError && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{generationError} The latest generated draft remains visible in the preview for review.</span>
                </div>
              )}
              <ol className="space-y-1.5">
                {genProgress.steps.map((s) => {
                  const open = previewStep === s.index;
                  const hasOutput = s.status === "done" && s.output != null;
                  const canPreview = s.status === "done";
                  return (
                    <li key={s.index} className="rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] px-3 py-2">
                      <button
                        type="button"
                        disabled={!canPreview}
                        onClick={() => {
                          if (!canPreview) return;
                          setPreviewStep(open ? null : s.index);
                        }}
                        className={`flex w-full items-center gap-2 text-left ${canPreview ? "cursor-pointer" : "cursor-default"}`}
                        title={canPreview ? (open ? "Hide step output" : "Preview this step's output") : undefined}
                      >
                        <span className="shrink-0">
                          {s.status === "done" ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ) : s.status === "pending" ? (
                            <Circle className="w-4 h-4 text-neutral-300 dark:text-white/20" />
                          ) : (
                            <Loader2 className="w-4 h-4 text-sky-500 animate-spin" />
                          )}
                        </span>
                        <span className="text-xs font-medium flex-1 truncate">
                          {s.index}. {s.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-200/70 dark:bg-white/10 text-neutral-600 dark:text-white/60 shrink-0">
                          {SECTION_LABEL[s.purpose as Purpose] ?? s.purpose}
                        </span>
                        {s.usage && (
                          <span className="text-[10px] tabular-nums text-neutral-400 dark:text-white/40 shrink-0">
                            {fmtTokens(s.usage.totalTokens)} tok · {fmtCost(s.usage.cost)}
                          </span>
                        )}
                        {canPreview && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-white/50">
                            <Eye className="w-3 h-3" />
                            {open ? "hide" : hasOutput ? "view" : "done"}
                          </span>
                        )}
                      </button>
                      {open && (
                        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-neutral-950 text-neutral-100 text-[10.5px] leading-snug p-2.5 whitespace-pre-wrap">
                          {hasOutput ? stepOutputText(s.output) : "No model output was stored for this step."}
                        </pre>
                      )}
                    </li>
                  );
                })}
                {genProgress.steps.length === 0 && (
                  <li className="text-xs text-neutral-400 dark:text-white/40 px-1">
                    {genProgress.message || "Starting pipeline…"}
                  </li>
                )}
              </ol>
            </div>
          )}

          {usage && (
            <div className={cardCls}>
              <SectionTitle icon={Coins}>Token usage &amp; cost</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(() => {
                  const labels = usageTokenLabels(usage.model);
                  const totalInput = usage.inputTokens + usage.cachedTokens;
                  return [
                    { label: labels.input, value: fmtTokens(usage.inputTokens) },
                    {
                      label: labels.cached,
                      value: fmtTokens(usage.cachedTokens),
                      hint: totalInput > 0 ? `${Math.round((usage.cachedTokens / totalInput) * 100)}% of input` : undefined,
                    },
                    { label: "Output", value: fmtTokens(usage.outputTokens) },
                    { label: "Total", value: fmtTokens(usage.totalTokens) },
                  ];
                })().map((s) => (
                  <div key={s.label} className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-white/40">{s.label}</div>
                    <div className="text-base font-medium tabular-nums">{s.value}</div>
                    {s.hint && <div className="text-[10px] text-neutral-400 dark:text-white/40">{s.hint}</div>}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl border border-sky-200/60 dark:border-sky-500/20 bg-sky-50/50 dark:bg-sky-500/[0.06] px-3 py-2">
                <span className="text-xs text-neutral-500 dark:text-white/50">
                  Estimated cost{usage.model ? ` · ${usage.model}` : ""}
                </span>
                <span className="text-base font-semibold text-sky-600 dark:text-sky-300 tabular-nums">{fmtCost(usage.cost)}</span>
              </div>
              {usage.cachedTokens > 0 && usage.savings != null && usage.savings > 0 && (
                <p className="mt-2 text-[11px] text-emerald-500">
                  Prompt cache hit — {fmtTokens(usage.cachedTokens)} input tokens billed at the cached rate (saved ~{fmtCost(usage.savings)}).
                </p>
              )}
            </div>
          )}

          <div className={cardCls}>
            <SectionTitle icon={Briefcase}>Job description</SectionTitle>
            <textarea
              className={areaCls}
              rows={6}
              value={config.jobDescription}
              onChange={(e) => setConfig((c) => ({ ...c, jobDescription: e.target.value }))}
              placeholder="Paste the target job description here…"
            />
            <p className="text-[11px] text-neutral-400 dark:text-white/40 mt-1">
              Reference it in any prompt with{" "}
              <code className="rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 px-1">{JOB_DESC_TOKEN}</code> — it is
              substituted with this text at generation time.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <Checkbox
                checked={config.dynamicCareerTitles}
                onCheckedChange={(checked) => setDynamicCareerTitles(checked === true)}
                aria-label="Dynamically tailor career titles"
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-neutral-700 dark:text-white/80">
                  Dynamically tailor career titles
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-white/50">
                  When checked, the model may use concise, job-aligned titles supported by each role. This saved choice also applies to Job Search and Agent résumé generation. When unchecked, Profile Settings titles stay exact.
                </span>
              </span>
            </label>
          </div>

          <details className={cardCls}>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium tracking-tight">
              <ListChecks className="h-4 w-4 text-sky-500" />
              Advanced generation steps
              <span className={`ml-auto text-xs ${validation.length > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                {validation.length > 0 ? `${validation.length} issue(s)` : `${steps.length} valid steps`}
              </span>
              <ChevronDown className="h-4 w-4 text-neutral-400" />
            </summary>
            <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-white/10">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-white/50">
                  Experience, Skills, and Summary run in parallel. Within each section, steps remain sequential and later steps see every earlier prompt and response.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(allStepsPromptMarkdown(steps));
                        notify({
                          title: "All prompts copied",
                          description: `${steps.length} step${steps.length === 1 ? "" : "s"} as markdown.`,
                          tone: "success",
                        });
                      } catch {
                        notify({ title: "Copy failed", description: "Could not write to the clipboard.", tone: "error" });
                      }
                    })();
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy prompts as markdown
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {PURPOSES.map((p) => (
                  <span
                    key={p}
                    className={`text-[11px] px-2 py-1 rounded-md border ${
                      finalCountByPurpose[p] === 1
                        ? "border-emerald-300 text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-300"
                        : "border-rose-300 text-rose-600 dark:border-rose-500/40 dark:text-rose-300"
                    }`}
                  >
                    {SECTION_LABEL[p]}: {finalCountByPurpose[p]} final
                  </span>
                ))}
              </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <StepCard
                  key={step.id}
                  step={step}
                  index={i}
                  total={steps.length}
                  hasOtherFinal={step.kind === "final" && finalCountByPurpose[step.purpose] > 1}
                  tokenValues={tokenValues}
                  onChange={(patch) => patchStep(step.id, patch)}
                  onMove={(dir) => moveStep(step.id, dir)}
                  onRemove={() => removeStep(step.id)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <span className="text-xs text-neutral-400 dark:text-white/40">Add fine-tune:</span>
              {PURPOSES.map((p) => (
                <button key={p} type="button" onClick={() => addFineTune(p)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-xs hover:bg-neutral-100 dark:hover:bg-white/5">
                  <Plus className="w-3.5 h-3.5" />
                  {SECTION_LABEL[p]}
                </button>
              ))}
            </div>
            {validation.length > 0 && (
              <ul className="mt-3 space-y-1">
                {validation.map((err) => (
                  <li key={err} className="text-[11px] text-rose-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> {err}
                  </li>
                ))}
              </ul>
            )}
            </div>
          </details>

          {/* Collapsible generation plan */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPlanOpen((v) => !v)}
                className="flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition"
                aria-expanded={planOpen}
              >
                <ListChecks className="w-4 h-4 text-sky-500 shrink-0" />
                <h2 className="text-sm font-medium tracking-tight">Generation plan</h2>
                <span className="text-[10px] text-neutral-400 dark:text-white/40">{plan.length} steps</span>
                <ChevronDown className={`w-4 h-4 text-neutral-400 transition ${planOpen ? "rotate-180" : ""}`} />
              </button>
              {planOpen && (
                <button
                  type="button"
                  onClick={() => setPlanJson((v) => !v)}
                  className="text-[11px] text-sky-600 dark:text-sky-300 hover:underline shrink-0"
                >
                  {planJson ? "Show steps" : "Show JSON"}
                </button>
              )}
            </div>

            {planOpen && (
              <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-white/10">
                {planJson ? (
                  <pre className="max-h-96 overflow-auto rounded-xl bg-neutral-950 text-neutral-100 text-xs p-4 leading-relaxed">
                    {JSON.stringify(resolvedRequestPayload, null, 2)}
                  </pre>
                ) : (
                  <ol className="space-y-2.5">
                    <li className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-white/40 mb-1">System instruction</div>
                      <div className="max-h-40 overflow-auto text-xs text-neutral-600 dark:text-white/60 whitespace-pre-wrap">{resolvedSystemInstruction}</div>
                    </li>
                    {resolvedPlan.map((s) => (
                      <li key={s.index} className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="grid place-items-center w-5 h-5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300 text-[10px] font-medium tabular-nums">{s.index}</span>
                          <span className="text-xs font-medium">{s.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-200/70 dark:bg-white/10 text-neutral-600 dark:text-white/60">{SECTION_LABEL[s.purpose]}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.kind === "final" ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-neutral-200/70 dark:bg-white/10 text-neutral-500 dark:text-white/50"}`}>
                            {s.kind === "final" ? "final · schema" : "fine-tune"}
                          </span>
                        </div>
                        <div className="max-h-64 overflow-auto text-[11px] text-neutral-600 dark:text-white/60 whitespace-pre-wrap">{s.prompt}</div>
                        {"schema" in s && (
                          <details className="mt-1.5">
                            <summary className="text-[10px] text-neutral-400 dark:text-white/40 cursor-pointer">output schema</summary>
                            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-neutral-950 text-neutral-100 text-[10px] p-2.5">{JSON.stringify(s.schema, null, 2)}</pre>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Sheet open={instructionOpen} onOpenChange={setInstructionOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-hidden border-l border-neutral-200 bg-white p-0 sm:max-w-xl dark:border-white/10 dark:bg-neutral-900"
        >
          <SheetHeader className="shrink-0 border-b border-neutral-200 px-5 py-4 pr-12 text-left dark:border-white/10">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-sky-500" />
              System instruction
            </SheetTitle>
            <SheetDescription className="text-xs leading-relaxed">
              Global writing rules for generation. Changes save automatically with the résumé configuration.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <JobRefField
              value={config.systemInstruction}
              onChange={(value) => setConfig((current) => ({ ...current, systemInstruction: value }))}
              tokenValues={tokenValues}
              rows={24}
              className="[&>textarea]:min-h-[calc(100vh-13rem)] [&>div]:min-h-[calc(100vh-13rem)]"
              ariaLabel="System instruction"
              placeholder="System instruction… use {job_description}, {career}, {company1}…"
            />
          </div>
        </SheetContent>
      </Sheet>

      <DesignModal open={designPanel === "template"} title="Template" icon={LayoutTemplate} onClose={closeDesignPanel} wide>
        <TemplatePanel
          templateId={config.templateId}
          onSelect={selectTemplate}
          uploadedTemplates={uploadedTemplates}
          templatesLoading={templatesLoading}
          onUpload={uploadTemplateFile}
          onSelectUploaded={selectUploadedTemplate}
          onDeleteUploaded={removeUploadedTemplate}
        />
      </DesignModal>
      <DesignModal open={designPanel === "theme" && !usingUploadedTemplate} title="Theme" icon={Palette} onClose={closeDesignPanel}>
        <ThemePanel theme={theme} onChange={setTheme} onApplyPalette={applyPalette} />
      </DesignModal>
      <DesignModal open={designPanel === "layout" && !usingUploadedTemplate} title="Section layout" icon={ListChecks} onClose={closeDesignPanel}>
        <SectionLayoutPanel layout={layout} onPatch={patchSection} onMove={moveSection} />
      </DesignModal>
    </>
  );
}

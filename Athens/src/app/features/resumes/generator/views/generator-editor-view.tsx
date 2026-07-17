import { useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Coins,
  Eye,
  FileText,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Field, Dropdown } from "../adapters/ui";
import { DesignModal } from "../components/design-modal";
import { SectionLayoutPanel, TemplatePanel, ThemePanel } from "../components/document-design-panels";
import { PreviewToolbar, type DesignPanel } from "../components/preview-toolbar";
import { SectionTitle } from "../components/editor-ui";
import { JobRefField } from "../components/job-ref-field";
import { StepCard } from "../components/step-card";
import { ResumePreview } from "../preview/resume-preview";
import { UploadedTemplatePreview } from "../preview/uploaded-template-preview";
import { PAGE } from "../preview/utils";
import { JOB_DESC_TOKEN } from "../constants/tokens";
import { FALLBACK_MODELS, PROVIDER_OPTIONS, REASONING_OPTIONS } from "../constants/defaults";
import { areaCls, cardCls, inputCls } from "../styles";
import { fmtCost, fmtTokens, stepOutputText } from "../utils/format";
import { usageTokenLabels } from "../../../agents/lib/runUsage";
import type { GeneratorPageVm } from "../hooks/use-generator-page";
import type { ProviderId, Purpose, ReasoningEffort } from "../types";
import { PURPOSES, SECTION_LABEL } from "../types";

export function GeneratorEditorView({ vm }: { vm: GeneratorPageVm }) {
  const {
    applier,
    config,
    setConfig,
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
    modelOptions,
    modelsLoading,
    modelsNote,
    loadingProfile,
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
    setIdentityField,
    loadIdentity,
    loadModels,
    exportResume,
    handleDownloadLog,
    handlePreviewEdit,
  } = vm;

  const [designPanel, setDesignPanel] = useState<DesignPanel | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const openDesignPanel = (panel: DesignPanel) => setDesignPanel(panel);
  const closeDesignPanel = () => setDesignPanel(null);

  return (
    <>
      <p className="text-sm text-neutral-500 dark:text-white/50 mb-6 max-w-3xl">
        The live preview stays fixed while you scroll the generation pipeline. Use the preview toolbar to open template,
        theme, and layout settings.
      </p>

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
              <PreviewToolbar
                activePanel={designPanel}
                onOpenPanel={openDesignPanel}
                showDownloadLog={Boolean(genProgress)}
                onDownloadLog={handleDownloadLog}
                exporting={exporting}
                onExportPdf={() => void exportResume("pdf")}
                onExportDocx={() => void exportResume("docx")}
                disablePdf={usingUploadedTemplate}
                disableThemeLayout={usingUploadedTemplate}
              />
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
          <div className={cardCls}>
            <SectionTitle icon={Sparkles}>Generation &amp; identity</SectionTitle>
            <p className="text-[11px] text-neutral-400 dark:text-white/40 mb-3">
              The model comes from your default in Settings → Profile.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {config.provider === "openai" && (
                <Field label="Reasoning effort">
                  <Dropdown<ReasoningEffort>
                    value={config.reasoningEffort}
                    onChange={(reasoningEffort) => setConfig((c) => ({ ...c, reasoningEffort }))}
                    options={REASONING_OPTIONS}
                  />
                </Field>
              )}
            </div>
            {modelsNote && <p className="text-[11px] text-amber-500 mt-1.5">{modelsNote}</p>}
            {config.provider === "openai" && (
              <p className="text-[11px] text-neutral-400 dark:text-white/40 mt-1.5">
                Only sent to OpenAI reasoning models (gpt-5*, o-series). <strong>low/medium/high</strong> work across models;{" "}
                <span className="font-mono">minimal</span> is nano-only and <span className="font-mono">xhigh</span> is newer-models-only.
              </p>
            )}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void loadIdentity()}
                disabled={loadingProfile || !applier?.name}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-neutral-200 dark:border-white/10 text-sm hover:bg-neutral-100 dark:hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingProfile ? "animate-spin" : ""}`} />
                Reload profile
              </button>
            </div>
            {applier?.name ? (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Full name">
                  <input className={inputCls} value={identity?.fullName ?? ""} onChange={(e) => setIdentityField("fullName", e.target.value)} />
                </Field>
                <Field label="Location">
                  <input className={inputCls} value={identity?.location ?? ""} onChange={(e) => setIdentityField("location", e.target.value)} />
                </Field>
                <Field label="Email">
                  <input className={inputCls} value={identity?.email ?? ""} onChange={(e) => setIdentityField("email", e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className={inputCls} value={identity?.phone ?? ""} onChange={(e) => setIdentityField("phone", e.target.value)} />
                </Field>
                <Field label="LinkedIn" cls="sm:col-span-2">
                  <input className={inputCls} value={identity?.linkedin ?? ""} onChange={(e) => setIdentityField("linkedin", e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-neutral-300 dark:border-white/15 p-5 text-center text-sm text-neutral-500 dark:text-white/50">
                Select an applier in the sidebar to auto-fill identity & career history.
              </div>
            )}
          </div>

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
                {genProgress.done ? "Generation complete" : "Generating…"}
              </SectionTitle>
              <ol className="space-y-1.5">
                {genProgress.steps.map((s) => {
                  const open = previewStep === s.index;
                  const hasOutput = s.status === "done" && s.output != null;
                  return (
                    <li key={s.index} className="rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0">
                          {s.status === "done" ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
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
                        {hasOutput && (
                          <button
                            type="button"
                            onClick={() => setPreviewStep(open ? null : s.index)}
                            title="View this step's raw output"
                            className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5"
                          >
                            <Eye className="w-3 h-3" />
                            {open ? "hide" : "view"}
                          </button>
                        )}
                      </div>
                      {open && hasOutput && (
                        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-neutral-950 text-neutral-100 text-[10.5px] leading-snug p-2.5 whitespace-pre-wrap">
                          {stepOutputText(s.output)}
                        </pre>
                      )}
                    </li>
                  );
                })}
                {genProgress.steps.length === 0 && (
                  <li className="text-xs text-neutral-400 dark:text-white/40 px-1">Starting pipeline…</li>
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
          </div>

          <div className={cardCls}>
            <SectionTitle icon={FileText}>System instruction</SectionTitle>
            <JobRefField
              value={config.systemInstruction}
              onChange={(v) => setConfig((c) => ({ ...c, systemInstruction: v }))}
              tokenValues={tokenValues}
              rows={6}
              placeholder="System instruction… use {job_description}, {career}, {company1}…"
            />
          </div>

          <div className={cardCls}>
            <SectionTitle icon={ListChecks} right={validation.length > 0 ? <span className="text-xs text-rose-500">{validation.length} issue(s)</span> : <span className="text-xs text-emerald-500">valid</span>}>
              Generation steps (run order)
            </SectionTitle>
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
                    {JSON.stringify(requestPayload, null, 2)}
                  </pre>
                ) : (
                  <ol className="space-y-2.5">
                    <li className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-white/40 mb-1">System instruction</div>
                      <div className="text-xs text-neutral-600 dark:text-white/60 line-clamp-3 whitespace-pre-wrap">{config.systemInstruction}</div>
                    </li>
                    {plan.map((s) => (
                      <li key={s.index} className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="grid place-items-center w-5 h-5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300 text-[10px] font-medium tabular-nums">{s.index}</span>
                          <span className="text-xs font-medium">{s.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-200/70 dark:bg-white/10 text-neutral-600 dark:text-white/60">{SECTION_LABEL[s.purpose]}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.kind === "final" ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-neutral-200/70 dark:bg-white/10 text-neutral-500 dark:text-white/50"}`}>
                            {s.kind === "final" ? "final · schema" : "fine-tune"}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-600 dark:text-white/60 whitespace-pre-wrap">{s.prompt}</div>
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

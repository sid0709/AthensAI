import React, { useEffect, useCallback, useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import type { EditorDraft } from "../../../types/resume";
import { useResumeEditor } from "../hooks/useResumeEditor";
import { ProviderIdentityPanel } from "./editor/ProviderIdentityPanel";
import { JobDescriptionPanel } from "./editor/JobDescriptionPanel";
import { RefinementPipelinePanel } from "./editor/RefinementPipelinePanel";
import { PreviewToolbar } from "./preview/PreviewToolbar";
import { ResumePreview } from "./preview/ResumePreview";
import { TemplatePickerModal } from "./modals/TemplatePickerModal";
import { ThemeModal } from "./modals/ThemeModal";
import { SectionLayoutModal } from "./modals/SectionLayoutModal";
import { applyTemplateSelection, resolveTemplateId, templateById } from "../lib/templates";
import { PAGE } from "../lib/previewUtils";

type ResumeEditorTabProps = {
  initialJd?: string;
  onGenerated?: () => void;
  onSwitchToHistory?: () => void;
  loadFromHistory?: { config: Partial<EditorDraft>; sections?: Record<string, unknown> } | null;
  onHistoryLoaded?: () => void;
};

export function ResumeEditorTab({
  initialJd,
  onGenerated,
  onSwitchToHistory,
  loadFromHistory,
  onHistoryLoaded,
}: ResumeEditorTabProps) {
  const editor = useResumeEditor();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    if (initialized || editor.loading) return;
    if (initialJd) editor.updateDraft({ jobDescription: initialJd });
    setInitialized(true);
  }, [initialized, editor.loading, initialJd, editor]);

  useEffect(() => {
    if (!loadFromHistory || editor.loading) return;
    void editor.loadFromHistory(loadFromHistory.config, loadFromHistory.sections).then(() => {
      onHistoryLoaded?.();
    });
  }, [loadFromHistory, editor, onHistoryLoaded]);

  const draft = editor.draft;
  const templateId = resolveTemplateId(draft?.templateId);
  const activeTemplate = templateById(templateId);

  const handleGenerate = async () => {
    setGenError(null);
    const result = await editor.generate();
    onGenerated?.();
    if (result.ok) onSwitchToHistory?.();
    else if (result.error) setGenError(result.error);
  };

  const handlePdf = useCallback(async () => {
    setExporting(true);
    try {
      await editor.exportResume("pdf");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }, [editor]);

  const handleWord = useCallback(async () => {
    setExporting(true);
    try {
      await editor.exportResume("docx");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Word export failed");
    } finally {
      setExporting(false);
    }
  }, [editor]);

  const handleSelectTemplate = (id: string) => {
    if (!draft) return;
    const resolved = resolveTemplateId(id);
    const applied = applyTemplateSelection(resolved, draft.theme, draft.sections);
    editor.updateDraft({
      templateId: applied.templateId,
      theme: applied.theme,
      sections: applied.sections,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (editor.draft) void editor.persist(editor.draft);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor.draft, editor.persist]);

  if (editor.loading || !draft) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const paper = draft.theme.paperSize === "a4" ? "a4" : "letter";
  const paperLabel = PAGE[paper].label;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <div>
          <p className="text-sm text-muted-foreground">
            {editor.generating ? editor.generateStep : "Edit identity & job description, then generate"}
          </p>
          {genError && <p className="text-xs text-destructive mt-0.5">{genError}</p>}
          {editor.usage && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {editor.usage.totalTokens?.toLocaleString() ?? 0} tokens · ${(editor.usage.cost ?? 0).toFixed(4)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={editor.generating || !draft.jobDescription.trim()}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 min-h-10"
        >
          {editor.generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Generate
        </button>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-[55] flex flex-col min-w-0 border-r border-border bg-secondary/30">
          <PreviewToolbar
            paperLabel={paperLabel}
            templateLabel={activeTemplate.name}
            onTemplate={() => setTemplateOpen(true)}
            onTheme={() => setThemeOpen(true)}
            onLayout={() => setLayoutOpen(true)}
            onPdf={handlePdf}
            onWord={handleWord}
            exporting={exporting}
          />
          <div className="flex-1 overflow-auto p-4 subtle-scroll min-h-0">
            <ResumePreview
              document={draft.document}
              templateId={templateId}
              theme={draft.theme}
              sections={draft.sections}
              generatorIdentity={draft.generatorIdentity ?? editor.generatorIdentity}
              generating={editor.generating}
              generatedSections={editor.generatedSections}
              fitToColumn
            />
          </div>
        </div>

        <div className="flex-[45] overflow-y-auto p-4 space-y-4 subtle-scroll">
          <ProviderIdentityPanel
            draft={draft}
            models={editor.models}
            loadingProfile={editor.loadingProfile}
            onReloadProfile={editor.reloadProfile}
            onIdentityChange={editor.updateIdentity}
            onProviderChange={(provider) => editor.updateDraft({ provider, model: editor.models[0] ?? draft.model })}
            onModelChange={(model) => editor.updateDraft({ model })}
            onReasoningChange={(reasoningEffort) => editor.updateDraft({ reasoningEffort })}
          />
          <JobDescriptionPanel
            value={draft.jobDescription}
            onChange={(jobDescription) => editor.updateDraft({ jobDescription })}
          />
          <RefinementPipelinePanel steps={draft.refinementSteps} onChange={editor.setRefinementSteps} />
        </div>
      </div>

      <TemplatePickerModal
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        selectedId={templateId}
        onSelect={handleSelectTemplate}
      />
      <ThemeModal
        open={themeOpen}
        onOpenChange={setThemeOpen}
        theme={draft.theme}
        onChange={(theme) => editor.updateDraft({ theme })}
      />
      <SectionLayoutModal
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
        sections={draft.sections}
        onChange={(sections) => editor.updateDraft({ sections })}
      />
    </div>
  );
}

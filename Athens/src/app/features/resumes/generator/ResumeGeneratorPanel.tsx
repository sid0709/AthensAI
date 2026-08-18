import { useEffect, useState, type ReactNode } from "react";
import { FileText, Wand2, Loader2 } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { GenerationHistory } from "./history/generation-history";
import { useGeneratorPage } from "./hooks/use-generator-page";
import { GeneratorEditorView } from "./views/generator-editor-view";
import { printCss } from "./preview/utils";
import type { FullRun } from "./history/history-types";

type ResumeGeneratorPanelProps = {
  /** When set, forces editor or history view (Athens top-level tabs). */
  activeView?: "editor" | "history";
  initialJd?: string;
  /** Load a history run into the editor (from Library / History). */
  pendingRun?: FullRun | null;
  onPendingRunConsumed?: () => void;
  onGenerated?: () => void;
  pageTabs?: ReactNode;
  pageActions?: ReactNode;
  /**
   * Delegate "Load into editor" from the History view up to the parent. Needed
   * when editor and history are separate mounts (Athens top-level tabs) that
   * each own a different generator hook instance, so loading locally would have
   * no effect on the editor and the forced `activeView` blocks an in-panel
   * switch. When omitted (standalone generator page), the run loads in-place.
   */
  onLoadIntoEditor?: (run: FullRun) => void;
};

export function ResumeGeneratorPanel({
  activeView,
  initialJd,
  pendingRun,
  onPendingRunConsumed,
  onGenerated,
  pageTabs,
  pageActions,
  onLoadIntoEditor,
}: ResumeGeneratorPanelProps) {
  const vm = useGeneratorPage();
  const {
    applier,
    theme,
    view,
    setView,
    generating,
    analyzingCoverage,
    stopping,
    validation,
    handleGenerate,
    handleCancelGeneration,
    setConfig,
    applyRun,
  } = vm;

  const [systemInstructionOpen, setSystemInstructionOpen] = useState(false);
  const effectiveView = activeView ?? view;

  useEffect(() => {
    if (activeView) setView(activeView);
  }, [activeView, setView]);

  useEffect(() => {
    if (!initialJd?.trim()) return;
    setConfig((c) => ({ ...c, jobDescription: initialJd }));
  }, [initialJd, setConfig]);

  useEffect(() => {
    if (!pendingRun) return;
    applyRun(pendingRun, { switchView: !activeView });
    onPendingRunConsumed?.();
  }, [pendingRun, applyRun, activeView, onPendingRunConsumed]);

  const onGenerate = async () => {
    const completed = await handleGenerate();
    if (completed) onGenerated?.();
  };

  const generateButton = (
    <button
      type="button"
      onClick={() => void (generating ? handleCancelGeneration() : onGenerate())}
      disabled={analyzingCoverage || stopping || (!generating && (validation.length > 0 || !applier?.name))}
      className={generating ? "athens-btn" : "athens-btn-primary"}
    >
      {generating || analyzingCoverage ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Wand2 size={16} aria-hidden="true" />}
      {stopping ? "Stopping…" : generating ? "Stop" : analyzingCoverage ? "Analyzing skills…" : "Generate"}
    </button>
  );

  return (
    <div className="min-h-0">
      <style>{printCss(theme.paper)}</style>

      {pageTabs ? (
        <div className="athens-toolbar mb-2">
          <div className="athens-surface">
            {pageTabs}
            <div className="athens-toolbar-row">
              <div className="athens-toolbar-actions ml-auto">
                {effectiveView === "editor" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSystemInstructionOpen(true)}
                      aria-haspopup="dialog"
                      aria-expanded={systemInstructionOpen}
                      className="athens-btn"
                    >
                      <FileText size={16} aria-hidden="true" />
                      System instruction
                    </button>
                    {generateButton}
                  </>
                ) : (
                  pageActions
                )}
              </div>
            </div>
          </div>
        </div>
      ) : effectiveView === "editor" ? (
        <div className="athens-toolbar mb-3">
          <div className="athens-surface">
            <div className="athens-toolbar-row">
              <p className="athens-changelog__intro">Generate a tailored resume from the job description and saved profile.</p>
              <div className="athens-toolbar-actions ml-auto">
                <button
                  type="button"
                  onClick={() => setSystemInstructionOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={systemInstructionOpen}
                  className="athens-btn"
                >
                  <FileText size={16} aria-hidden="true" />
                  System instruction
                </button>
                {generateButton}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {effectiveView === "history" ? (
        <GenerationHistory
          applierName={applier?.name ?? null}
          onLoad={onLoadIntoEditor ?? ((run) => applyRun(run))}
        />
      ) : (
        <GeneratorEditorView
          vm={vm}
          systemInstructionOpen={systemInstructionOpen}
          onSystemInstructionOpenChange={setSystemInstructionOpen}
        />
      )}
    </div>
  );
}

export { useGeneratorPage } from "./hooks/use-generator-page";
export type { FullRun } from "./history/history-types";
export { applyHistoryRun } from "./hooks/load-history-run";

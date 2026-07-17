import { Wand2 } from "lucide-react";
import { PageHeader } from "../../components/page-header";
import { GenerationHistory } from "./history/generation-history";
import { useGeneratorPage } from "./hooks/use-generator-page";
import { GeneratorEditorView } from "./views/generator-editor-view";
import { printCss } from "./preview/utils";

export function GeneratorPage() {
  const vm = useGeneratorPage();
  const {
    applier,
    theme,
    view,
    setView,
    generating,
    validation,
    handleGenerate,
    applyRun,
  } = vm;

  return (
    <div className="w-full">
      <style>{printCss(theme.paper)}</style>
      <PageHeader
        kicker="Settings"
        title="Resume Generator"
        actions={
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || validation.length > 0 || !applier?.name}
            className="inline-flex items-center gap-2 px-4 h-[42px] rounded-xl bg-neutral-900 text-white text-sm hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-neutral-900 dark:hover:bg-white/90"
          >
            <Wand2 className="w-4 h-4" />
            {generating ? "Generating…" : "Generate"}
          </button>
        }
      />

      <div className="flex items-center gap-1 mb-5 p-1 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 w-fit">
        {(["editor", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setView(t)}
            className={`px-4 py-2 text-sm rounded-lg capitalize transition ${
              view === t
                ? "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium shadow-sm"
                : "text-neutral-500 dark:text-white/50 hover:text-neutral-800 dark:hover:text-white/80"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {view === "history" ? (
        <GenerationHistory
          applierName={applier?.name ?? null}
          onLoad={(run) => applyRun(run)}
        />
      ) : (
        <GeneratorEditorView vm={vm} />
      )}
    </div>
  );
}

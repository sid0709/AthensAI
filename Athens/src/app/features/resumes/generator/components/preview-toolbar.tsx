import { Download, FileJson, FileType2, LayoutTemplate, ListChecks, Palette } from "lucide-react";

export type DesignPanel = "template" | "theme" | "layout";

const btn =
  "inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-neutral-200 dark:border-white/10 text-xs hover:bg-neutral-100 dark:hover:bg-white/5 transition disabled:opacity-50 disabled:cursor-not-allowed";
const activeBtn =
  "inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-sky-400 bg-sky-50/60 dark:bg-sky-500/10 text-xs text-sky-700 dark:text-sky-300 transition";

export function PreviewToolbar({
  activePanel,
  onOpenPanel,
  showDownloadLog,
  onDownloadLog,
  exporting,
  onExportPdf,
  onExportDocx,
  disablePdf,
  disableThemeLayout,
}: {
  activePanel: DesignPanel | null;
  onOpenPanel: (panel: DesignPanel) => void;
  showDownloadLog: boolean;
  onDownloadLog: () => void;
  exporting: "pdf" | "docx" | null;
  onExportPdf: () => void;
  onExportDocx: () => void;
  disablePdf?: boolean;
  disableThemeLayout?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onOpenPanel("template")}
        className={activePanel === "template" ? activeBtn : btn}
        title="Choose resume template"
      >
        <LayoutTemplate className="w-3.5 h-3.5" />
        Template
      </button>
      <button
        type="button"
        onClick={() => !disableThemeLayout && onOpenPanel("theme")}
        disabled={disableThemeLayout}
        className={activePanel === "theme" ? activeBtn : btn}
        title={disableThemeLayout ? "Theme not available for uploaded templates" : "Font, colors, paper size"}
      >
        <Palette className="w-3.5 h-3.5" />
        Theme
      </button>
      <button
        type="button"
        onClick={() => !disableThemeLayout && onOpenPanel("layout")}
        disabled={disableThemeLayout}
        className={activePanel === "layout" ? activeBtn : btn}
        title={disableThemeLayout ? "Layout not available for uploaded templates" : "Section order and sizing"}
      >
        <ListChecks className="w-3.5 h-3.5" />
        Layout
      </button>

      <span className="hidden sm:block w-px h-6 bg-neutral-200 dark:bg-white/10 mx-0.5" />

      {showDownloadLog && (
        <button type="button" onClick={onDownloadLog} className={btn} title="Download generation log JSON">
          <FileJson className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Log</span>
        </button>
      )}
      <button
        type="button"
        onClick={onExportPdf}
        disabled={exporting !== null || disablePdf}
        className={btn}
        title={disablePdf ? "PDF export not available for uploaded templates" : "Export PDF"}
      >
        <Download className="w-3.5 h-3.5" />
        {exporting === "pdf" ? "Exporting…" : "PDF"}
      </button>
      <button
        type="button"
        onClick={onExportDocx}
        disabled={exporting !== null}
        className={btn}
        title="Export Word document"
      >
        <FileType2 className="w-3.5 h-3.5" />
        {exporting === "docx" ? "Exporting…" : "Word"}
      </button>
    </div>
  );
}

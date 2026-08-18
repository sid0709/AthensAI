import { FileJson, FileType2, LayoutTemplate, ListChecks, Palette } from "lucide-react";
import { cn } from "../../../../lib/utils";

export type DesignPanel = "template" | "theme" | "layout";

export function PreviewToolbar({
  activePanel,
  onOpenPanel,
  showDownloadLog,
  onDownloadLog,
  exporting,
  onExportDocx,
  disableThemeLayout,
}: {
  activePanel: DesignPanel | null;
  onOpenPanel: (panel: DesignPanel) => void;
  showDownloadLog: boolean;
  onDownloadLog: () => void;
  exporting: "docx" | null;
  onExportDocx: () => void;
  disableThemeLayout?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="athens-segment" role="group" aria-label="Document design">
        <button
          type="button"
          onClick={() => onOpenPanel("template")}
          className={cn(activePanel === "template" && "is-active")}
          title="Choose resume template"
        >
          <LayoutTemplate size={16} aria-hidden="true" />
          <span className="athens-segment__label">Template</span>
        </button>
        <button
          type="button"
          onClick={() => !disableThemeLayout && onOpenPanel("theme")}
          disabled={disableThemeLayout}
          className={cn(activePanel === "theme" && "is-active")}
          title={disableThemeLayout ? "Theme not available for uploaded templates" : "Font, colors, paper size"}
        >
          <Palette size={16} aria-hidden="true" />
          <span className="athens-segment__label">Theme</span>
        </button>
        <button
          type="button"
          onClick={() => !disableThemeLayout && onOpenPanel("layout")}
          disabled={disableThemeLayout}
          className={cn(activePanel === "layout" && "is-active")}
          title={disableThemeLayout ? "Layout not available for uploaded templates" : "Section order and sizing"}
        >
          <ListChecks size={16} aria-hidden="true" />
          <span className="athens-segment__label">Layout</span>
        </button>
      </div>

      {showDownloadLog ? (
        <button type="button" onClick={onDownloadLog} className="athens-btn" title="Download generation log JSON">
          <FileJson size={16} aria-hidden="true" />
          Log
        </button>
      ) : null}
      <button
        type="button"
        onClick={onExportDocx}
        disabled={exporting !== null}
        className="athens-btn"
        title="Export Word document"
      >
        <FileType2 size={16} aria-hidden="true" />
        {exporting === "docx" ? "Exporting…" : "Word"}
      </button>
    </div>
  );
}

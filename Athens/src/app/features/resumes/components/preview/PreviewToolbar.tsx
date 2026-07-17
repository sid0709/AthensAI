import { LayoutTemplate, Palette, ListOrdered, FileDown, FileType } from "lucide-react";
import { cn } from "../../../../lib/utils";

type PreviewToolbarProps = {
  paperLabel: string;
  templateLabel?: string;
  onTemplate: () => void;
  onTheme: () => void;
  onLayout: () => void;
  onPdf: () => void;
  onWord: () => void;
  exporting?: boolean;
  className?: string;
};

export function PreviewToolbar({
  paperLabel,
  templateLabel,
  onTemplate,
  onTheme,
  onLayout,
  onPdf,
  onWord,
  exporting,
  className,
}: PreviewToolbarProps) {
  return (
    <div className={cn("flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-card/80 backdrop-blur", className)}>
      <div className="mr-auto">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Live preview</p>
        <p className="text-sm text-foreground">
          {paperLabel}
          {templateLabel ? ` · ${templateLabel}` : ""}
        </p>
      </div>
      <ToolbarBtn icon={LayoutTemplate} label="Template" onClick={onTemplate} />
      <ToolbarBtn icon={Palette} label="Theme" onClick={onTheme} />
      <ToolbarBtn icon={ListOrdered} label="Layout" onClick={onLayout} />
      <div className="w-px h-6 bg-border mx-1" />
      <ToolbarBtn icon={FileDown} label="PDF" onClick={onPdf} disabled={exporting} />
      <ToolbarBtn icon={FileType} label="Word" onClick={onWord} disabled={exporting} primary />
    </div>
  );
}

function ToolbarBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors min-h-9",
        primary
          ? "bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          : "bg-secondary border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

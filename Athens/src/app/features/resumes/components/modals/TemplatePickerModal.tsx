import { useRef } from "react";
import { LayoutTemplate, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { cn } from "../../../../lib/utils";
import { TEMPLATES, templateById, resolveTemplateId } from "../../lib/templates";
import { TemplateGlyph } from "./TemplateGlyph";

type TemplatePickerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  onSelect: (id: string) => void;
};

export function TemplatePickerModal({
  open,
  onOpenChange,
  selectedId,
  onSelect,
}: TemplatePickerModalProps) {
  const resolvedSelected = resolveTemplateId(selectedId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-primary" />
            Template
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            The <strong>template</strong> sets the layout (columns, header &amp; heading alignment, heading style).
            Use <strong>Theme</strong> to restyle it.
          </p>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-2">
          {TEMPLATES.map((tpl) => {
            const active = tpl.id === resolvedSelected;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  onSelect(tpl.id);
                  onOpenChange(false);
                }}
                className={cn(
                  "text-left rounded-xl p-3 border transition-all hover:shadow-md",
                  active ? "border-primary ring-1 ring-primary/40 bg-primary/5" : "border-border bg-card hover:bg-secondary/40",
                )}
              >
                <TemplateGlyph template={tpl} />
                <p className="text-xs font-semibold mt-2 text-foreground">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{tpl.blurb}</p>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { templateById };

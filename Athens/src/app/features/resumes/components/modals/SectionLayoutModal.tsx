import { ListOrdered } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SectionLayoutConfig, SectionId } from "../../../../types/resume";

const SECTION_LABELS: Record<SectionId, string> = {
  summary: "Summary",
  experience: "Experience",
  skills: "Skills",
  education: "Education",
};

type SectionLayoutModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionLayoutConfig[];
  onChange: (sections: SectionLayoutConfig[]) => void;
};

export function SectionLayoutModal({ open, onOpenChange, sections, onChange }: SectionLayoutModalProps) {
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  const update = (id: SectionId, patch: Partial<SectionLayoutConfig>) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const move = (id: SectionId, dir: -1 | 1) => {
    const idx = sorted.findIndex((s) => s.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const next = sorted.map((s, i) => {
      if (i === idx) return { ...s, order: sorted[swapIdx].order };
      if (i === swapIdx) return { ...s, order: sorted[idx].order };
      return s;
    });
    onChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-primary" />
            Section layout
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {sorted.map((sec, idx) => (
            <div key={sec.id} className="flex items-center gap-3 bg-secondary/50 rounded-xl p-3 border border-border">
              <span className="text-sm font-bold text-foreground w-24 shrink-0">{SECTION_LABELS[sec.id]}</span>
              <label className="text-xs text-muted-foreground">
                T
                <input
                  type="number"
                  value={sec.titleSizePt}
                  onChange={(e) => update(sec.id, { titleSizePt: +e.target.value })}
                  className="w-12 ml-1 bg-background border border-border rounded px-1 py-0.5 text-sm"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                B
                <input
                  type="number"
                  value={sec.bodySizePt}
                  onChange={(e) => update(sec.id, { bodySizePt: +e.target.value })}
                  className="w-12 ml-1 bg-background border border-border rounded px-1 py-0.5 text-sm"
                />
              </label>
              <input
                type="color"
                value={sec.color}
                onChange={(e) => update(sec.id, { color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer shrink-0"
              />
              <div className="flex gap-1 ml-auto">
                <button type="button" disabled={idx === 0} onClick={() => move(sec.id, -1)} className="icon-btn w-8 h-8 disabled:opacity-30">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button type="button" disabled={idx === sorted.length - 1} onClick={() => move(sec.id, 1)} className="icon-btn w-8 h-8 disabled:opacity-30">
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

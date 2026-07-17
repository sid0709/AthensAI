import React from "react";
import { Palette } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { AthensInput, AthensSelect, FormField } from "../../../../components/forms";
import type { ResumeTheme } from "../../../../types/resume";

const FONTS = ["Source Sans 3", "Inter", "Georgia", "Helvetica", "IBM Plex Sans"];
const PALETTES = [
  { name: "Navy", accent: "#1f3a5f", text: "#0f172a" },
  { name: "Emerald", accent: "#047857", text: "#064e3b" },
  { name: "Burgundy", accent: "#7f1d1d", text: "#1c1917" },
  { name: "Royal", accent: "#1d4ed8", text: "#0f172a" },
  { name: "Slate", accent: "#475569", text: "#0f172a" },
  { name: "Teal", accent: "#0f766e", text: "#134e4a" },
  { name: "Plum", accent: "#6b21a8", text: "#1e1b4b" },
  { name: "Charcoal", accent: "#374151", text: "#111827" },
];

type ThemeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ResumeTheme;
  onChange: (theme: ResumeTheme) => void;
};

export function ThemeModal({ open, onOpenChange, theme, onChange }: ThemeModalProps) {
  const set = (patch: Partial<ResumeTheme>) => onChange({ ...theme, ...patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            Theme
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <AthensSelect
            label="Font"
            value={theme.font}
            onChange={(font) => set({ font })}
            options={FONTS.map((f) => ({ value: f, label: f }))}
          />
          <AthensSelect
            label="Header align"
            value={theme.headerAlign}
            onChange={(headerAlign) => set({ headerAlign: headerAlign as ResumeTheme["headerAlign"] })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
            ]}
          />
          <FormField label="Body size (pt)">
            <AthensInput type="number" step="0.5" value={theme.bodySizePt} onChange={(e) => set({ bodySizePt: +e.target.value })} />
          </FormField>
          <FormField label="Name size (pt)">
            <AthensInput type="number" step="0.5" value={theme.nameSizePt} onChange={(e) => set({ nameSizePt: +e.target.value })} />
          </FormField>
          <FormField label="Accent color">
            <div className="flex gap-2">
              <input type="color" value={theme.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="w-10 h-10 rounded cursor-pointer" />
              <AthensInput value={theme.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="flex-1 font-mono text-xs" />
            </div>
          </FormField>
          <FormField label="Text color">
            <div className="flex gap-2">
              <input type="color" value={theme.textColor} onChange={(e) => set({ textColor: e.target.value })} className="w-10 h-10 rounded cursor-pointer" />
              <AthensInput value={theme.textColor} onChange={(e) => set({ textColor: e.target.value })} className="flex-1 font-mono text-xs" />
            </div>
          </FormField>
          <AthensSelect
            label="Paper size"
            value={theme.paperSize}
            onChange={(paperSize) => set({ paperSize: paperSize as ResumeTheme["paperSize"] })}
            options={[
              { value: "letter", label: "Letter" },
              { value: "a4", label: "A4" },
            ]}
          />
          <FormField label="Margin (in)">
            <AthensInput type="number" step="0.05" value={theme.marginIn} onChange={(e) => set({ marginIn: +e.target.value })} />
          </FormField>
        </div>
        <div className="mt-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Palettes</p>
          <div className="flex flex-wrap gap-2">
            {PALETTES.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => set({ accentColor: p.accent, textColor: p.text })}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-xs font-semibold hover:bg-secondary"
              >
                <span className="w-4 h-4 rounded-full" style={{ background: p.accent }} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

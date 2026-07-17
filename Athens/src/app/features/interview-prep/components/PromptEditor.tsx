import React from "react";

type PromptEditorProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
};

export function PromptEditor({ label, value, onChange, rows = 6, placeholder }: PromptEditorProps) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="mt-2 w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono leading-relaxed outline-none focus:border-primary/40 resize-y min-h-[120px]"
      />
    </label>
  );
}

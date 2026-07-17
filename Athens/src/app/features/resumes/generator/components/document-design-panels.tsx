import { useRef } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { Field, Dropdown } from "../adapters/ui";
import { TemplateGlyph } from "./template-glyph";
import { TEMPLATES } from "../constants/templates";
import { FONT_OPTIONS, PALETTES } from "../constants/defaults";
import { inputCls, numCls } from "../styles";
import { SECTION_LABEL } from "../types";
import type { LayoutSection, PaperSize, ResumeTheme, UploadedTemplateManifest } from "../types";
import { isUploadedTemplateId } from "../types";

function slotSummary(manifest: UploadedTemplateManifest) {
  const parts = manifest.sectionsFound.map((s) => {
    const count = manifest.slots.filter((slot) => slot.section === s).length;
    return `${count} ${s}`;
  });
  return `${manifest.slotCount} slot${manifest.slotCount === 1 ? "" : "s"}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
}

export function TemplatePanel({
  templateId,
  onSelect,
  uploadedTemplates,
  templatesLoading,
  onUpload,
  onSelectUploaded,
  onDeleteUploaded,
}: {
  templateId: string;
  onSelect: (id: string) => void;
  uploadedTemplates: UploadedTemplateManifest[];
  templatesLoading?: boolean;
  onUpload: (file: File) => void | Promise<void>;
  onSelectUploaded: (manifest: UploadedTemplateManifest) => void;
  onDeleteUploaded: (id: string) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <p className="text-[11px] text-neutral-400 dark:text-white/40 mb-4">
        The <strong className="text-neutral-600 dark:text-white/70">template</strong> sets the layout (columns, header &amp; heading
        alignment, heading style). Upload a Word <code className="text-[10px]">.docx</code> with{" "}
        <code className="text-[10px]">{"{}"}</code> placeholders for AI content. Use <strong className="text-neutral-600 dark:text-white/70">Theme</strong> to restyle built-in templates.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-left rounded-xl border border-dashed border-sky-400/60 p-3 transition hover:bg-sky-50/40 dark:hover:bg-sky-500/10 min-h-[108px] flex flex-col justify-center"
        >
          <div className="w-full h-14 rounded-lg border border-sky-200/60 dark:border-sky-500/20 bg-sky-50/50 dark:bg-sky-500/5 grid place-items-center">
            <Upload className="w-5 h-5 text-sky-500" />
          </div>
          <div className="text-xs font-medium mt-2">Upload template</div>
          <div className="text-[10px] text-neutral-400 dark:text-white/40 leading-tight mt-0.5">DOCX with {"{}"} placeholders</div>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
            e.target.value = "";
          }}
        />

        {templatesLoading && (
          <div className="col-span-full text-[11px] text-neutral-400 dark:text-white/40 -mt-1">Loading uploaded templates…</div>
        )}

        {uploadedTemplates.map((tpl) => {
          const active = templateId === `upload:${tpl.id}`;
          return (
            <div key={tpl.id} className="relative">
              <button
                type="button"
                onClick={() => onSelectUploaded(tpl)}
                className={`w-full text-left rounded-xl border p-3 transition ${
                  active
                    ? "border-sky-500 ring-1 ring-sky-500/40 bg-sky-50/50 dark:bg-sky-500/10"
                    : "border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5"
                }`}
              >
                <div className="w-full h-14 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] grid place-items-center">
                  <span className="text-[10px] font-semibold tracking-wide text-sky-600 dark:text-sky-300">DOCX</span>
                </div>
                <div className="text-xs font-medium mt-2 truncate pr-5">{tpl.name}</div>
                <div className="text-[10px] text-neutral-400 dark:text-white/40 leading-tight mt-0.5">{slotSummary(tpl)}</div>
                {tpl.warnings.length > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3 h-3" />
                    {tpl.warnings.length} warning{tpl.warnings.length === 1 ? "" : "s"}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => void onDeleteUploaded(tpl.id)}
                className="absolute top-2 right-2 w-6 h-6 rounded-md text-[10px] text-neutral-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                aria-label={`Delete ${tpl.name}`}
                title="Delete template"
              >
                ×
              </button>
            </div>
          );
        })}

        {TEMPLATES.map((t) => {
          const active = !isUploadedTemplateId(templateId) && t.id === templateId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={`text-left rounded-xl border p-3 transition ${
                active
                  ? "border-sky-500 ring-1 ring-sky-500/40 bg-sky-50/50 dark:bg-sky-500/10"
                  : "border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
            >
              <TemplateGlyph template={t} />
              <div className="text-xs font-medium mt-2">{t.name}</div>
              <div className="text-[10px] text-neutral-400 dark:text-white/40 leading-tight mt-0.5">{t.blurb}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function ThemePanel({
  theme,
  onChange,
  onApplyPalette,
}: {
  theme: ResumeTheme;
  onChange: (patch: Partial<ResumeTheme>) => void;
  onApplyPalette: (accent: string, text: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Field label="Font">
          <Dropdown<string> value={theme.font} onChange={(font) => onChange({ font })} options={FONT_OPTIONS} />
        </Field>
        <Field label="Body size (pt)">
          <input
            type="number"
            step="0.5"
            min={7}
            max={16}
            className={inputCls}
            value={theme.baseSize}
            onChange={(e) => onChange({ baseSize: Number(e.target.value) || 10 })}
          />
        </Field>
        <Field label="Name size (pt)">
          <input
            type="number"
            step="1"
            min={14}
            max={40}
            className={inputCls}
            value={theme.nameSize}
            onChange={(e) => onChange({ nameSize: Number(e.target.value) || 22 })}
          />
        </Field>
        <Field label="Accent color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={theme.accent}
              onChange={(e) => onChange({ accent: e.target.value })}
              className="w-10 h-10 rounded-lg border border-neutral-200 dark:border-white/10 bg-transparent cursor-pointer"
            />
            <input className={`${inputCls} font-mono text-xs`} value={theme.accent} onChange={(e) => onChange({ accent: e.target.value })} />
          </div>
        </Field>
        <Field label="Text color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={theme.text}
              onChange={(e) => onChange({ text: e.target.value })}
              className="w-10 h-10 rounded-lg border border-neutral-200 dark:border-white/10 bg-transparent cursor-pointer"
            />
            <input className={`${inputCls} font-mono text-xs`} value={theme.text} onChange={(e) => onChange({ text: e.target.value })} />
          </div>
        </Field>
        <Field label="Header align">
          <Dropdown<"left" | "center">
            value={theme.headerAlign}
            onChange={(headerAlign) => onChange({ headerAlign })}
            options={[
              { value: "center", label: "Center" },
              { value: "left", label: "Left" },
            ]}
          />
        </Field>
        <Field label="Paper size">
          <Dropdown<PaperSize>
            value={theme.paper}
            onChange={(paper) => onChange({ paper })}
            options={[
              { value: "letter", label: "Letter", hint: '8.5" × 11"' },
              { value: "a4", label: "A4", hint: "210 × 297 mm" },
            ]}
          />
        </Field>
        <Field label="Margin (in)">
          <input
            type="number"
            step="0.05"
            min={0.25}
            max={1.5}
            className={inputCls}
            value={theme.margin}
            onChange={(e) => onChange({ margin: Number(e.target.value) || 0.6 })}
          />
        </Field>
      </div>
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-white/40 mb-2">Palettes</div>
        <div className="flex flex-wrap gap-2">
          {PALETTES.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => onApplyPalette(p.accent, p.text)}
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 text-xs hover:bg-neutral-100 dark:hover:bg-white/5"
              title={p.name}
            >
              <span className="w-3.5 h-3.5 rounded-full" style={{ background: p.accent }} />
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function SectionLayoutPanel({
  layout,
  onPatch,
  onMove,
}: {
  layout: LayoutSection[];
  onPatch: (id: string, patch: Partial<LayoutSection>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  return (
    <div className="space-y-2">
      {layout.map((s, i) => (
        <div
          key={s.id}
          className="flex items-center gap-2 flex-wrap rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] px-3 py-2"
        >
          <span className="text-xs font-medium flex-1 min-w-[120px] shrink-0">{SECTION_LABEL[s.type]}</span>
          <label className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-white/40" title="Title size (pt)">
            T
            <input
              type="number"
              step="0.5"
              min={8}
              max={20}
              className={numCls}
              value={s.titleSize}
              onChange={(e) => onPatch(s.id, { titleSize: Number(e.target.value) || 12 })}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-white/40" title="Body size (pt)">
            B
            <input
              type="number"
              step="0.5"
              min={7}
              max={16}
              className={numCls}
              value={s.bodySize}
              onChange={(e) => onPatch(s.id, { bodySize: Number(e.target.value) || 10 })}
            />
          </label>
          <input
            type="color"
            value={s.titleColor}
            onChange={(e) => onPatch(s.id, { titleColor: e.target.value })}
            className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-white/10 bg-transparent cursor-pointer shrink-0"
            title="Title color"
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onMove(s.id, -1)}
              disabled={i === 0}
              className="w-8 h-8 grid place-items-center rounded-lg border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onMove(s.id, 1)}
              disabled={i === layout.length - 1}
              className="w-8 h-8 grid place-items-center rounded-lg border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5 disabled:opacity-40"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

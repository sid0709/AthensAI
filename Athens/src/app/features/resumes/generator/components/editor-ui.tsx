import type { ReactNode } from "react";
import { Field } from "../adapters/ui";
import { inputCls } from "../styles";

export function SectionTitle({ icon: Icon, children, right }: { icon: any; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-sky-500" />
        <h2 className="text-sm font-medium tracking-tight">{children}</h2>
      </div>
      {right}
    </div>
  );
}

export function EditorCard({
  icon: Icon,
  title,
  subtitle,
  right,
  children,
  bodyClassName = "",
}: {
  icon: any;
  title: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 overflow-hidden shadow-sm">
      <div className="px-5 py-4 md:px-6 border-b border-neutral-200 dark:border-white/10 flex items-start justify-between gap-3 bg-neutral-50/60 dark:bg-white/[0.02]">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 grid place-items-center shrink-0">
              <Icon className="w-4 h-4 text-sky-500" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-white">{title}</h2>
          </div>
          {subtitle && <p className="text-[11px] text-neutral-500 dark:text-white/50 mt-1.5 ml-[42px] leading-relaxed">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className={`p-5 md:p-6 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

export function EditorSubheading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-white/40 mb-3">{children}</h3>;
}

export function IconField({
  label,
  icon: Icon,
  value,
  onChange,
  type = "text",
  cls = "",
}: {
  label: string;
  icon: any;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  cls?: string;
}) {
  return (
    <Field label={label} cls={cls}>
      <div className="relative">
        <Icon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-white/40 pointer-events-none" />
        <input type={type} className={`${inputCls} pl-9`} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

export { TemplateGlyph } from "./template-glyph";

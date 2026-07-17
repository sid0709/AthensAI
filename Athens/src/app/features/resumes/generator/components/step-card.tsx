import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Dropdown, Field } from "../adapters/ui";
import { PURPOSES, SECTION_LABEL, type GenStep, type Purpose, type StepKind } from "../types";
import {
  defaultPromptFor,
  defaultSchemaFor,
} from "../constants/defaults";
import { isValidJson } from "../utils/identity";
import { areaCls, inputCls } from "../styles";
import { JobRefField } from "./job-ref-field";

export function StepCard({
  step,
  index,
  total,
  hasOtherFinal,
  tokenValues,
  onChange,
  onMove,
  onRemove,
}: {
  step: GenStep;
  index: number;
  total: number;
  hasOtherFinal: boolean;
  tokenValues: Record<string, string>;
  onChange: (patch: Partial<GenStep>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [schemaOpen, setSchemaOpen] = useState(false);
  const isFinal = step.kind === "final";
  const schemaValid = isValidJson(step.schema);
  const duplicateFinal = isFinal && hasOtherFinal;

  const setKind = (kind: StepKind) => {
    if (kind === step.kind) return;
    // Becoming final: ensure it has a schema. Going fine-tune: keep schema text
    // but it is ignored.
    const patch: Partial<GenStep> = { kind };
    if (kind === "final" && !step.schema.trim()) patch.schema = defaultSchemaFor(step.purpose);
    onChange(patch);
  };

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition ${
        duplicateFinal || (isFinal && !schemaValid)
          ? "border-rose-300 dark:border-rose-500/40 bg-rose-50/30 dark:bg-rose-500/[0.04]"
          : "border-neutral-200 dark:border-white/10 bg-neutral-50/80 dark:bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200/80 dark:border-white/10 flex-wrap bg-white/70 dark:bg-neutral-900/50">
        <span className="grid place-items-center w-7 h-7 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300 text-xs font-semibold tabular-nums shrink-0">
          {index + 1}
        </span>
        <input
          className={`${inputCls} h-9 flex-1 min-w-[140px] !bg-white dark:!bg-neutral-900`}
          value={step.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Step name"
        />
        <Dropdown<Purpose>
          value={step.purpose}
          onChange={(purpose) =>
            onChange({
              purpose,
              schema: step.schema === defaultSchemaFor(step.purpose) ? defaultSchemaFor(purpose) : step.schema,
            })
          }
          options={PURPOSES.map((p) => ({ value: p, label: SECTION_LABEL[p] }))}
          size="sm"
          width="w-[128px]"
        />
        <div className="inline-flex rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden text-xs shrink-0 p-0.5 bg-neutral-100/80 dark:bg-white/5">
          {(["fine-tune", "final"] as StepKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 rounded-lg transition ${
                step.kind === k
                  ? k === "final"
                    ? "bg-sky-500 text-white shadow-sm"
                    : "bg-neutral-800 text-white dark:bg-white/20"
                  : "text-neutral-500 dark:text-white/50 hover:text-neutral-800 dark:hover:text-white/80"
              }`}
            >
              {k === "final" ? "Final" : "Fine-tune"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Run earlier"
            className="w-8 h-8 grid place-items-center rounded-lg border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Run later"
            className="w-8 h-8 grid place-items-center rounded-lg border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={isFinal}
            title={isFinal ? "Each section needs its final step" : "Remove step"}
            className="w-8 h-8 grid place-items-center rounded-lg border border-neutral-200 dark:border-white/10 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
      {duplicateFinal && (
        <p className="text-[11px] text-rose-500 mb-2 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {SECTION_LABEL[step.purpose]} already has a final step — only one is allowed.
        </p>
      )}

      <Field label="Prompt">
        <JobRefField
          value={step.prompt}
          onChange={(prompt) => onChange({ prompt })}
          tokenValues={tokenValues}
          rows={3}
          placeholder="User-turn prompt… use {job_description}, {job_skills}, {career}, {company1}…"
        />
      </Field>

      <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-xl border border-neutral-200 dark:border-white/10 bg-white/60 dark:bg-neutral-900/40 px-3 py-2.5">
        <input
          type="checkbox"
          checked={Boolean(step.skipForStructuredJobs)}
          onChange={(e) => onChange({ skipForStructuredJobs: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
        />
        <span className="text-[11px] leading-snug text-neutral-500 dark:text-white/60">
          <span className="font-medium text-neutral-700 dark:text-white/80">Skip for structured jobs</span> — don't
          run this step for Job Search / Agent runs, where the job already carries fetched skills. Reference them in a
          later prompt via <code className="text-sky-600 dark:text-sky-300">{"{job_skills}"}</code>. Free-text
          generation on this page always runs the step.
        </span>
      </label>

      {isFinal ? (
        <>
          <button
            type="button"
            onClick={() => setSchemaOpen((v) => !v)}
            className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-white/50 hover:text-neutral-800 dark:hover:text-white/80"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition ${schemaOpen ? "" : "-rotate-90"}`} />
            Output schema <span className="text-rose-400">*</span>
            {!schemaValid && <span className="text-rose-500 font-medium">· invalid JSON</span>}
          </button>
          {schemaOpen && (
            <div className="mt-2">
              <textarea
                className={`${areaCls} font-mono text-xs ${schemaValid ? "" : "border-rose-400 dark:border-rose-500/60"}`}
                rows={8}
                value={step.schema}
                onChange={(e) => onChange({ schema: e.target.value })}
                spellCheck={false}
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-neutral-400 dark:text-white/40">Required for final steps · must be valid JSON.</span>
                <button
                  type="button"
                  onClick={() => onChange({ schema: defaultSchemaFor(step.purpose) })}
                  className="text-[11px] text-sky-600 dark:text-sky-300 hover:underline"
                >
                  Reset to {SECTION_LABEL[step.purpose]} default
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-[11px] text-neutral-400 dark:text-white/40">
          Fine-tuning step — no output schema; it refines the running {SECTION_LABEL[step.purpose].toLowerCase()} draft.
        </p>
      )}
      </div>
    </div>
  );
}

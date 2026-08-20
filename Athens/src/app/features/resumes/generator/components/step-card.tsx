import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Dropdown, Field } from "../adapters/ui";
import { PURPOSES, SECTION_LABEL, type GenStep, type Purpose, type StepKind } from "../types";
import {
  defaultSchemaFor,
} from "../constants/defaults";
import { isValidJson } from "../utils/identity";
import { areaCls, inputCls } from "../styles";
import { JobRefField } from "./job-ref-field";

/** Markdown snapshot of a generation step (header + prompt body). */
export function stepPromptMarkdown(step: GenStep, index: number): string {
  const name = step.name.trim() || `Step ${index + 1}`;
  const section = SECTION_LABEL[step.purpose] ?? step.purpose;
  const kind = step.kind === "final" ? "Final" : "Fine-tune";
  const skip = step.skipForStructuredJobs ? "Yes" : "No";
  const prompt = step.prompt.trim() || "_(empty)_";
  return [
    `# ${name}`,
    "",
    `- **Step:** ${index + 1}`,
    `- **Section:** ${section}`,
    `- **Type:** ${kind}`,
    `- **Skip for structured jobs:** ${skip}`,
    "",
    "## Prompt",
    "",
    prompt,
    "",
  ].join("\n");
}

/** Concatenate every step into one markdown document. */
export function allStepsPromptMarkdown(steps: GenStep[]): string {
  return steps
    .map((step, index) => stepPromptMarkdown(step, index))
    .join("\n---\n\n");
}

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
      className={`athens-surface overflow-hidden ${
        duplicateFinal || (isFinal && !schemaValid) ? "athens-prompt-step--invalid" : ""
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--athens-border)] flex-wrap bg-[var(--athens-surface-subtle)]">
        <span className="athens-count">{index + 1}</span>
        <input
          className={`${inputCls} h-10 flex-1 min-w-[140px]`}
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
        <div className="athens-segment" role="group" aria-label="Step type">
          {(["fine-tune", "final"] as StepKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={step.kind === k ? "is-active" : undefined}
            >
              <span className="athens-segment__label">{k === "final" ? "Final" : "Fine-tune"}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Run earlier"
            className="athens-icon-btn"
          >
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Run later"
            className="athens-icon-btn"
          >
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={isFinal}
            title={isFinal ? "Each section needs its final step" : "Remove step"}
            className="athens-icon-btn athens-settings__danger"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
      {duplicateFinal && (
        <p className="text-xs text-[var(--athens-danger)] mb-2 flex items-center gap-1">
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

      <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-[var(--athens-radius-sm)] border border-[var(--athens-border)] bg-[var(--athens-surface-subtle)] px-3 py-2.5">
        <input
          type="checkbox"
          checked={Boolean(step.skipForStructuredJobs)}
          onChange={(e) => onChange({ skipForStructuredJobs: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span className="text-xs leading-snug text-[var(--athens-text-secondary)]">
          <span className="font-medium text-[var(--athens-text)]">Skip for structured jobs</span> — don't
          run this step for Job Search / Agent runs, where the job already carries fetched skills. Reference them in a
          later prompt via <code className="athens-prompt-token">{"{job_skills}"}</code>. Free-text
          generation on this page always runs the step.
        </span>
      </label>

      {isFinal ? (
        <>
          <button
            type="button"
            onClick={() => setSchemaOpen((v) => !v)}
            className="mt-3 athens-text-btn"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition ${schemaOpen ? "" : "-rotate-90"}`} />
            Output schema <span className="text-[var(--athens-danger)]">*</span>
            {!schemaValid && <span className="font-medium text-[var(--athens-danger)]">· invalid JSON</span>}
          </button>
          {schemaOpen && (
            <div className="mt-2">
              <textarea
                className={`${areaCls} font-mono text-xs ${schemaValid ? "" : "border-[var(--athens-danger)]"}`}
                rows={8}
                value={step.schema}
                onChange={(e) => onChange({ schema: e.target.value })}
                spellCheck={false}
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--athens-text-muted)]">Required for final steps · must be valid JSON.</span>
                <button
                  type="button"
                  onClick={() => onChange({ schema: defaultSchemaFor(step.purpose) })}
                  className="athens-text-btn"
                >
                  Reset to {SECTION_LABEL[step.purpose]} default
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs text-[var(--athens-text-muted)]">
          Fine-tuning step — no output schema; it refines the running {SECTION_LABEL[step.purpose].toLowerCase()} draft.
        </p>
      )}
      </div>
    </div>
  );
}

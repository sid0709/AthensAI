import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { AthensInput, AthensSelect, AthensTextarea, FormField } from "../../../../components/forms";
import { cn } from "../../../../lib/utils";
import type { RefinementStep, StepKind, StepPurpose } from "../../../../types/resume";
import { defaultPromptFor, defaultSchemaFor, uid } from "../../lib/generatorDefaults";
import { isValidJson } from "../../lib/identityFromProfile";

type RefinementPipelinePanelProps = {
  steps: RefinementStep[];
  onChange: (steps: RefinementStep[]) => void;
};

const PURPOSE_OPTIONS: { value: StepPurpose; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "skills", label: "Skills" },
  { value: "experience", label: "Experience" },
];

function StepSchemaField({
  step,
  onUpdate,
}: {
  step: RefinementStep;
  onUpdate: (schema: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const schemaValid = isValidJson(step.schema ?? "");

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition", open ? "" : "-rotate-90")} />
        Output schema
        {!schemaValid && <span className="text-destructive font-medium">· invalid JSON</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <AthensTextarea
            value={step.schema ?? ""}
            onChange={(e) => onUpdate(e.target.value)}
            rows={8}
            className={cn("font-mono text-xs", !schemaValid && "border-destructive")}
            spellCheck={false}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Required for final steps · valid JSON.</span>
            <button
              type="button"
              onClick={() => onUpdate(defaultSchemaFor(step.purpose))}
              className="text-[11px] font-bold text-primary hover:underline"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RefinementPipelinePanel({ steps, onChange }: RefinementPipelinePanelProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  const addStep = () => {
    const step: RefinementStep = {
      id: uid(),
      purpose: "experience",
      kind: "fine-tune",
      name: `Step ${steps.length + 1}`,
      prompt: defaultPromptFor("experience", "fine-tune"),
    };
    onChange([...steps, step]);
    setPanelOpen(true);
  };

  const update = (id: string, patch: Partial<RefinementStep>) => {
    onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const remove = (id: string) => {
    const target = steps.find((s) => s.id === id);
    if (target?.kind === "final") return;
    onChange(steps.filter((s) => s.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = steps.findIndex((s) => s.id === id);
    const next = idx + dir;
    if (next < 0 || next >= steps.length) return;
    const copy = [...steps];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-secondary/40 transition-colors"
      >
        <div>
          <h3 className="text-sm font-bold text-foreground">AI refinement pipeline</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{steps.length} step(s)</p>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition", panelOpen ? "" : "-rotate-90")} />
      </button>

      {panelOpen && (
        <div className="px-5 pb-5 border-t border-border">
          <div className="flex justify-end mt-3 mb-4">
            <button type="button" onClick={addStep} className="flex items-center gap-1 text-xs font-bold text-primary hover:underline">
              <Plus className="w-3.5 h-3.5" />
              Add step
            </button>
          </div>
          <div className="space-y-4">
            {steps.map((step, idx) => (
              <div key={step.id} className="border border-border rounded-xl p-4 bg-secondary/30">
                <div className="flex items-start gap-2 mb-3">
                  <span className="grid place-items-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                    {idx + 1}
                  </span>
                  <AthensInput
                    value={step.name}
                    onChange={(e) => update(step.id, { name: e.target.value })}
                    className="flex-1 font-bold"
                  />
                  <div className="flex gap-1">
                    <button type="button" disabled={idx === 0} onClick={() => move(step.id, -1)} className="icon-btn w-8 h-8 disabled:opacity-30">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" disabled={idx === steps.length - 1} onClick={() => move(step.id, 1)} className="icon-btn w-8 h-8 disabled:opacity-30">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => remove(step.id)} disabled={step.kind === "final"} className="icon-btn w-8 h-8 text-destructive disabled:opacity-30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <AthensSelect
                    label="Purpose"
                    value={step.purpose}
                    onChange={(purpose) => {
                      const p = purpose as StepPurpose;
                      update(step.id, {
                        purpose: p,
                        prompt: defaultPromptFor(p, step.kind),
                        schema: step.kind === "final" ? defaultSchemaFor(p) : undefined,
                      });
                    }}
                    options={PURPOSE_OPTIONS}
                  />
                  <div>
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Kind</span>
                    <div className="flex gap-1 mt-1.5">
                      {(["fine-tune", "final"] as StepKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() =>
                            update(step.id, {
                              kind,
                              prompt: defaultPromptFor(step.purpose, kind),
                              schema: kind === "final" ? defaultSchemaFor(step.purpose) : undefined,
                            })
                          }
                          className={cn(
                            "flex-1 py-1.5 rounded-lg text-xs font-bold capitalize border",
                            step.kind === kind ? "bg-primary text-white border-primary" : "bg-background border-border text-muted-foreground",
                          )}
                        >
                          {kind}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <AthensTextarea
                  value={step.prompt}
                  onChange={(e) => update(step.id, { prompt: e.target.value })}
                  placeholder="Prompt instructions for this step… use {job_description}, {job_skills}, {career}…"
                  rows={3}
                  className="mb-1"
                />
                <label className="flex items-start gap-2.5 cursor-pointer select-none mt-2 mb-1">
                  <input
                    type="checkbox"
                    checked={Boolean(step.skipForStructuredJobs)}
                    onChange={(e) => update(step.id, { skipForStructuredJobs: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    <span className="font-bold text-foreground">Skip for structured jobs</span> — skip this step for
                    Job Search / Agent runs, where the job already carries fetched skills (use{" "}
                    <code className="text-primary">{"{job_skills}"}</code> in a later prompt). Free-text generation
                    always runs it.
                  </span>
                </label>
                {step.kind === "final" ? (
                  <StepSchemaField step={step} onUpdate={(schema) => update(step.id, { schema })} />
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Fine-tuning step — no output schema; it refines the running {step.purpose} draft.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

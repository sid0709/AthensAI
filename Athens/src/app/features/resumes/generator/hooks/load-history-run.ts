import type { Dispatch, SetStateAction } from "react";
import { ensurePurposes, uid } from "../constants/defaults";
import { normalizeGenerated } from "../utils/content";
import type { FullRun } from "../history/history-types";
import type {
  GeneratedContent,
  GeneratorConfig,
  GenStep,
  LayoutSection,
  Purpose,
  ReasoningEffort,
  ResumeTheme,
  StepKind,
  UsageBreakdown,
} from "../types";

export function applyHistoryRun(
  run: FullRun,
  setConfig: Dispatch<SetStateAction<GeneratorConfig>>,
  setGenerated: Dispatch<SetStateAction<GeneratedContent | null>>,
  setUsage: Dispatch<SetStateAction<UsageBreakdown | null>>,
  setView?: Dispatch<SetStateAction<"editor" | "history">>,
) {
  const rc = (run.config ?? {}) as Record<string, unknown>;
  const planSteps = Array.isArray(rc.steps) ? (rc.steps as Array<Record<string, unknown>>) : null;
  const steps: GenStep[] | undefined = planSteps?.length
    ? planSteps.map((s) => ({
        id: uid(),
        purpose: (s.purpose as Purpose) ?? "summary",
        kind: (s.kind as StepKind) ?? "final",
        name: String(s.name ?? ""),
        prompt: String(s.prompt ?? ""),
        schema: s.schema ? JSON.stringify(s.schema, null, 2) : "",
      }))
    : undefined;
  setConfig((c) =>
    ensurePurposes({
      ...c,
      provider: rc.provider === "deepseek" ? "deepseek" : "openai",
      model: typeof rc.model === "string" ? rc.model : c.model,
      reasoningEffort: (rc.reasoningEffort as ReasoningEffort) ?? c.reasoningEffort,
      templateId: typeof rc.templateId === "string" ? rc.templateId : c.templateId,
      theme: { ...c.theme, ...((rc.theme as Partial<ResumeTheme>) ?? {}) },
      layout: Array.isArray(rc.layout) && (rc.layout as LayoutSection[]).length ? (rc.layout as LayoutSection[]) : c.layout,
      systemInstruction: typeof rc.systemInstruction === "string" ? rc.systemInstruction : c.systemInstruction,
      jobDescription: typeof rc.jobDescription === "string" ? rc.jobDescription : c.jobDescription,
      ...(steps ? { steps } : {}),
    }),
  );
  if (run.sections) setGenerated(normalizeGenerated(run.sections));
  if (run.usage) setUsage(run.usage);
  setView?.("editor");
}

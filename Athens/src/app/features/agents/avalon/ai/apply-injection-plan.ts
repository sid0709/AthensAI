import type {
  ActionablePageContext,
  ApplyInjectionPlanPayload,
  AttachedFile,
  InjectionPlan,
} from "@avalon/shared";

export function buildApplyInjectionPlanPayload(
  plan: InjectionPlan,
  page: ActionablePageContext,
  options: { autoSubmit?: boolean; submitDelayMs?: number; resumeFile?: AttachedFile } = {},
): ApplyInjectionPlanPayload {
  return {
    plan,
    page,
    ...(options.autoSubmit !== undefined ? { autoSubmit: options.autoSubmit } : {}),
    ...(options.submitDelayMs !== undefined ? { submitDelayMs: options.submitDelayMs } : {}),
    ...(options.resumeFile ? { resumeFile: options.resumeFile } : {}),
  };
}

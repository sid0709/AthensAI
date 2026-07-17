import type {
  ActionableTree,
  ControlType,
  InjectionPlan,
  InjectionStep,
  InjectionStepOp,
} from "@avalon/shared";
import type { FieldAction, FieldActionPlan } from "./types";

export interface BuildInjectionPlanOptions {
  tree: ActionableTree;
  fields: FieldActionPlan[];
}

export interface FieldInjectionPreview {
  id: string;
  preview: string;
}

export interface InjectionPlanResult {
  plan: InjectionPlan;
  preview: string;
  fieldPreviews: FieldInjectionPreview[];
}

function deriveOp(action: FieldAction, controlType: ControlType): InjectionStepOp | null {
  switch (action) {
    case "Click":
      return "click";
    case "FileUpload":
      return "attachFile";
    case "Check":
    case "Uncheck":
      return "setChecked";
    case "SelectOption":
      return controlType === "combobox" ? "typeCombobox" : "selectOption";
    case "Typing":
      if (controlType === "combobox") return "typeCombobox";
      if (controlType === "select") return "selectOption";
      return "setValue";
    default:
      return null;
  }
}

function describeStep(step: InjectionStep, index: number): string {
  const head = `${index + 1}. ${step.op} "${step.label}"`;
  if (step.op === "attachFile") return `${head} → tailored PDF`;
  if (step.op === "setChecked") return `${head} = ${step.checked ? "checked" : "unchecked"}`;
  if (step.op === "click") return head;
  return `${head} = ${step.value ?? ""}`;
}

/** Final form submit — scanned for visibility but clicked by auto-submit after fill. */
const FORM_SUBMIT_LABEL =
  /\b(submit(\s+(application|my\s+application))?|send application|finish|complete)\b/i;

function isDeferredFormSubmit(entry: {
  target: string;
  controlType: ControlType;
  control: InjectionStep["control"];
}): boolean {
  if (entry.controlType !== "button") return false;
  const label = entry.target.trim();
  if (label && FORM_SUBMIT_LABEL.test(label)) return true;
  return entry.control.properties?.some((p) => p.attribute === "type" && p.pattern === "submit") ?? false;
}

/** Only create attachFile when Analyze chose FileUpload with shouldSkip No (tailored PDF). */
function fileUploadStep(
  id: string,
  label: string,
  field: FieldActionPlan | undefined,
  control: InjectionStep["control"],
): InjectionStep | null {
  if (!field || field.shouldSkip === "Yes") return null;
  if (field.action !== "FileUpload") return null;
  return { id, label, op: "attachFile", control, value: field.value };
}

export function buildFormInjectionPlan(options: BuildInjectionPlanOptions): InjectionPlanResult {
  const { tree, fields } = options;
  const planById = new Map(fields.map((f) => [f.id, f]));
  const steps: InjectionStep[] = [];
  const fieldPreviews: FieldInjectionPreview[] = [];

  tree.forEach((group, groupIdx) => {
    group.children.forEach((entry, childIdx) => {
      const id = `${groupIdx}:${childIdx}`;
      const label = entry.target || id;

      if (entry.controlType === "file") {
        const step = fileUploadStep(id, label, planById.get(id), entry.control);
        if (step) steps.push(step);
        return;
      }

      const field = planById.get(id);
      if (!field || field.shouldSkip === "Yes") return;

      const op = deriveOp(field.action, entry.controlType);
      if (!op || op === "attachFile") return;
      if (op === "click" && isDeferredFormSubmit(entry)) return;

      const step: InjectionStep = {
        id,
        label: entry.target || id,
        op,
        control: entry.control,
      };
      if (op === "setChecked") {
        step.checked = field.action !== "Uncheck";
      } else if (op !== "click") {
        step.value = field.value;
      }

      steps.push(step);
    });
  });

  // File uploads (résumé/CV) are the top priority and must run first. Stable
  // partition keeps every other step in its original order.
  const orderedSteps = [
    ...steps.filter((s) => s.op === "attachFile"),
    ...steps.filter((s) => s.op !== "attachFile"),
  ];

  orderedSteps.forEach((step, index) => {
    fieldPreviews.push({ id: step.id, preview: describeStep(step, index) });
  });

  const preview = orderedSteps.map(describeStep).join("\n");
  return { plan: { steps: orderedSteps }, preview, fieldPreviews };
}

import type { ActionableTree } from "@avalon/shared";

export type FieldAction = "Click" | "Typing" | "SelectOption" | "FileUpload" | "Check" | "Uncheck";

export interface FlatFormField {
  id: string;
  groupIndex: number;
  childIndex: number;
  groupContext: string;
  label: string;
  required: boolean;
  controlType: string;
  controlTag: string;
  options?: string[];
  optionsSource?: string;
  skippable?: boolean;
}

export interface FieldActionPlan {
  id: string;
  action: FieldAction;
  shouldSkip: "Yes" | "No";
  value: string;
  notes?: string;
}

export interface FormAnalysisResult {
  fields: FieldActionPlan[];
  usage?: {
    model?: string | null;
    provider?: string | null;
    promptTokens: number;
    cachedTokens?: number;
    completionTokens: number;
    totalTokens: number;
    cost?: {
      totalUsd: number;
      currency: string;
      rates?: {
        promptPer1M: number;
        completionPer1M: number;
      };
    };
  };
}

export interface AnalyzeFormOptions {
  tree: ActionableTree;
  applicantContext?: string;
}

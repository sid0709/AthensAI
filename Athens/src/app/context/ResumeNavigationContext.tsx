import { createContext, useContext } from "react";

export type OpenEditorOptions = {
  jd?: string;
  resumeId?: string;
  tab?: "library" | "editor" | "history" | "analysis";
};

export type ResumeNavigationContextValue = {
  openEditor: (opts?: OpenEditorOptions) => void;
  pendingEditorOpen: OpenEditorOptions | null;
  clearPendingEditorOpen: () => void;
};

export const ResumeNavigationContext = createContext<ResumeNavigationContextValue | null>(null);

export function useResumeNavigation() {
  const ctx = useContext(ResumeNavigationContext);
  if (!ctx) throw new Error("useResumeNavigation must be used within ResumeNavigationProvider");
  return ctx;
}

export function useResumeNavigationOptional() {
  return useContext(ResumeNavigationContext);
}

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { RunSummary } from "../types/agent";

type AgentRunContextValue = {
  openRun: (run: RunSummary) => void;
};

const AgentRunContext = createContext<AgentRunContextValue | null>(null);

export function AgentRunProvider({ children }: { children: ReactNode }) {
  const openRun = useCallback((_run: RunSummary) => {
    // Agents page is Avalon-only; navigate via dashboard widget instead.
  }, []);

  const value = useMemo(() => ({ openRun }), [openRun]);

  return <AgentRunContext.Provider value={value}>{children}</AgentRunContext.Provider>;
}

export function useAgentRunContext() {
  const ctx = useContext(AgentRunContext);
  if (!ctx) throw new Error("useAgentRunContext must be used within AgentRunProvider");
  return ctx;
}

export function useAgentRunContextOptional() {
  return useContext(AgentRunContext);
}

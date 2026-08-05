import { create } from "zustand";
import { parseWorkspaceRoute, type WorkspaceRoute } from "../navigation/routes";
import type { Job } from "../types";

export interface TabWorkspace {
  route: WorkspaceRoute;
  aiJob: Job | null;
}

export function createDefaultTabWorkspace(): TabWorkspace {
  return {
    route: { view: "jobs" },
    aiJob: null,
  };
}

interface TabWorkspaceState {
  byTabId: Record<number, TabWorkspace>;
  ensureTab(tabId: number): TabWorkspace;
  getWorkspace(tabId: number | null): TabWorkspace;
  setRoute(tabId: number, route: WorkspaceRoute): void;
  setAiJob(tabId: number, job: Job | null): void;
  removeTab(tabId: number): void;
  clearAll(): void;
}

export const useTabWorkspaceStore = create<TabWorkspaceState>((set, get) => ({
  byTabId: {},

  ensureTab(tabId) {
    const existing = get().byTabId[tabId];
    if (existing) return existing;
    // First tracked tab inherits the current panel hash (deep links / tests).
    // Later browser tabs start on the jobs list until the user navigates there.
    const isFirstTab = Object.keys(get().byTabId).length === 0;
    const created = isFirstTab
      ? { route: parseWorkspaceRoute(window.location.hash), aiJob: null }
      : createDefaultTabWorkspace();
    set((state) => ({
      byTabId: { ...state.byTabId, [tabId]: created },
    }));
    return created;
  },

  getWorkspace(tabId) {
    if (tabId == null) return createDefaultTabWorkspace();
    return get().byTabId[tabId] ?? createDefaultTabWorkspace();
  },

  setRoute(tabId, route) {
    const current = get().byTabId[tabId] ?? createDefaultTabWorkspace();
    set((state) => ({
      byTabId: {
        ...state.byTabId,
        [tabId]: { ...current, route },
      },
    }));
  },

  setAiJob(tabId, job) {
    const current = get().byTabId[tabId] ?? createDefaultTabWorkspace();
    set((state) => ({
      byTabId: {
        ...state.byTabId,
        [tabId]: { ...current, aiJob: job },
      },
    }));
  },

  removeTab(tabId) {
    set((state) => {
      if (!state.byTabId[tabId]) return state;
      const next = { ...state.byTabId };
      delete next[tabId];
      return { byTabId: next };
    });
  },

  clearAll() {
    set({ byTabId: {} });
  },
}));

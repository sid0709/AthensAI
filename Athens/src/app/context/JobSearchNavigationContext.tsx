import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { JobSearchFilterState } from "../hooks/useJobSearchFilters";

export type OpenJobSearchOptions = Partial<JobSearchFilterState>;

export type JobSearchNavigationContextValue = {
  openJobSearch: (opts?: OpenJobSearchOptions) => void;
  pendingFilters: OpenJobSearchOptions | null;
  clearPendingFilters: () => void;
};

export const JobSearchNavigationContext = createContext<JobSearchNavigationContextValue | null>(null);

export function useJobSearchNavigationOptional() {
  return useContext(JobSearchNavigationContext);
}

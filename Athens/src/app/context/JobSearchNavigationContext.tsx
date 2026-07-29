import { createContext, useContext } from "react";
import type { JobSearchFilterState } from "../hooks/useJobSearchFilters";

export type OpenJobSearchOptions = Partial<JobSearchFilterState>;

export type JobSearchNavigationContextValue = {
  openJobSearch: (opts?: OpenJobSearchOptions) => void;
};

export const JobSearchNavigationContext = createContext<JobSearchNavigationContextValue | null>(null);

export function useJobSearchNavigationOptional() {
  return useContext(JobSearchNavigationContext);
}

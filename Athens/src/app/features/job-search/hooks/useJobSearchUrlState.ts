import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { JobSearchFilterState } from "../../../hooks/useJobSearchFilters";
import {
  JOB_SEARCH_PAGE_SIZES,
  canonicalJobSearchQuery,
  jobSearchFilterTransition,
  jobSearchPageSizeTransition,
  parseJobSearchUrl,
  serializeJobSearchUrl,
  type JobSearchUrlState,
  type JobSearchView,
} from "../lib/jobSearchUrlState";

export function useJobSearchUrlState() {
  const [params, setParams] = useSearchParams();
  const rawQuery = params.toString();
  const state = useMemo(() => parseJobSearchUrl(new URLSearchParams(rawQuery)), [rawQuery]);

  useEffect(() => {
    const canonical = canonicalJobSearchQuery(new URLSearchParams(rawQuery));
    if (canonical !== rawQuery) setParams(new URLSearchParams(canonical), { replace: true });
  }, [rawQuery, setParams]);

  const commit = useCallback((next: JobSearchUrlState, replace: boolean) => {
    setParams(serializeJobSearchUrl(next), { replace });
  }, [setParams]);

  const setFilters = useCallback((filters: JobSearchFilterState) => {
    const transition = jobSearchFilterTransition(state, filters);
    if (transition.changed) commit(transition.state, transition.replace);
  }, [commit, state]);

  const replaceFilters = useCallback((filters: JobSearchFilterState) => {
    commit({ ...state, filters, page: 1, groupId: "", jobId: "" }, true);
  }, [commit, state]);

  const setPage = useCallback((page: number) => {
    const normalized = Math.max(1, Math.trunc(page));
    if (normalized !== state.page) commit({ ...state, page: normalized, groupId: "", jobId: "" }, false);
  }, [commit, state]);

  const clampPage = useCallback((page: number) => {
    const normalized = Math.max(1, Math.trunc(page));
    if (normalized !== state.page) commit({ ...state, page: normalized, groupId: "", jobId: "" }, true);
  }, [commit, state]);

  const setPageSize = useCallback((pageSize: number) => {
    const normalized = JOB_SEARCH_PAGE_SIZES.includes(pageSize as JobSearchUrlState["pageSize"])
      ? pageSize as JobSearchUrlState["pageSize"]
      : 25;
    if (normalized !== state.pageSize) commit(jobSearchPageSizeTransition(state, normalized), false);
  }, [commit, state]);

  const setView = useCallback((view: JobSearchView) => {
    commit({ ...state, view }, false);
  }, [commit, state]);

  const setOpenJob = useCallback((groupId: string, jobId: string) => {
    commit({ ...state, groupId, jobId: groupId ? jobId : "" }, true);
  }, [commit, state]);

  const clearOpenJob = useCallback(() => {
    if (state.groupId || state.jobId) commit({ ...state, groupId: "", jobId: "" }, true);
  }, [commit, state]);

  return {
    state,
    setFilters,
    replaceFilters,
    setPage,
    clampPage,
    setPageSize,
    setView,
    setOpenJob,
    clearOpenJob,
  };
}

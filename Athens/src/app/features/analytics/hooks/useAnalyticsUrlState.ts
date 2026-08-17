import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { AnalyticsFilterState } from "../lib/analyticsFilters";
import {
  canonicalAnalyticsQuery,
  parseAnalyticsUrl,
  serializeAnalyticsUrl,
} from "../lib/analyticsUrlState";

export function useAnalyticsUrlState() {
  const [params, setParams] = useSearchParams();
  const rawQuery = params.toString();
  const filters = useMemo(
    () => parseAnalyticsUrl(new URLSearchParams(rawQuery)),
    [rawQuery],
  );

  useEffect(() => {
    const canonical = canonicalAnalyticsQuery(new URLSearchParams(rawQuery));
    if (canonical !== rawQuery) {
      setParams(new URLSearchParams(canonical), { replace: true });
    }
  }, [rawQuery, setParams]);

  const setFilters = useCallback(
    (next: AnalyticsFilterState) => {
      const query = serializeAnalyticsUrl(next).toString();
      if (query !== rawQuery) setParams(new URLSearchParams(query), { replace: false });
    },
    [rawQuery, setParams],
  );

  return { filters, setFilters };
}

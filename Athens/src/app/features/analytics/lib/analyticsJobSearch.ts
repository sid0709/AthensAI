import { defaultJobSearchHref } from "../../job-search/lib/jobSearchUrlState";
import type { JobStatusTab } from "../../../hooks/useJobSearchFilters";
import { isCatalogSource } from "./analyticsFilters";

export function analyticsJobSearchHref({
  source,
  sources = [],
  startDay,
  endDay,
  status = "all",
}: {
  source?: string;
  sources?: string[];
  startDay: string;
  endDay: string;
  status?: JobStatusTab;
}): string | null {
  const selected = source ? [source] : sources;
  const catalog = selected.filter(isCatalogSource);
  if (source && !isCatalogSource(source)) return null;
  return defaultJobSearchHref({
    source: catalog,
    postedFrom: startDay,
    postedTo: endDay,
    statusTab: status,
  });
}

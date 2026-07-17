import { useCallback, useMemo, useRef, useState } from "react";
import type { Job } from "../../../types";

export function useJobSelection(results: Job[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorIndexRef = useRef<number | null>(null);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    results.forEach((job, index) => map.set(job.id, index));
    return map;
  }, [results]);

  const selectRange = useCallback(
    (from: number, to: number) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const job = results[i];
          if (job) next.add(job.id);
        }
        return next;
      });
    },
    [results],
  );

  const selectJob = useCallback(
    (id: string, shiftKey: boolean) => {
      const index = indexById.get(id);
      if (index === undefined) return;

      if (shiftKey && anchorIndexRef.current !== null) {
        selectRange(anchorIndexRef.current, index);
        return;
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorIndexRef.current = index;
    },
    [indexById, selectRange],
  );

  const selectAllOnPage = useCallback(
    (pageIds: string[], allSelected: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          pageIds.forEach((id) => next.delete(id));
        } else {
          pageIds.forEach((id) => next.add(id));
          const lastId = pageIds[pageIds.length - 1];
          const lastIndex = lastId ? indexById.get(lastId) : undefined;
          if (lastIndex !== undefined) anchorIndexRef.current = lastIndex;
        }
        return next;
      });
    },
    [indexById],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    anchorIndexRef.current = null;
  }, []);

  const selectedJobs = useMemo(
    () => results.filter((job) => selectedIds.has(job.id)),
    [results, selectedIds],
  );

  return {
    selectedIds,
    selectedJobs,
    selectJob,
    selectAllOnPage,
    clearSelection,
  };
}

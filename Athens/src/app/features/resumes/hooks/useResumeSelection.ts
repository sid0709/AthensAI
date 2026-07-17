import { useCallback, useMemo, useRef, useState } from "react";
import type { UserResumeSummary } from "../../../types/resume";

export function useResumeSelection(resumes: UserResumeSummary[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorIndexRef = useRef<number | null>(null);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    resumes.forEach((resume, index) => map.set(resume.id, index));
    return map;
  }, [resumes]);

  const selectRange = useCallback(
    (from: number, to: number) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const resume = resumes[i];
          if (resume) next.add(resume.id);
        }
        return next;
      });
    },
    [resumes],
  );

  const selectResume = useCallback(
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

  const selectAll = useCallback(
    (ids: string[], allSelected: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          ids.forEach((id) => next.delete(id));
        } else {
          ids.forEach((id) => next.add(id));
          const lastId = ids[ids.length - 1];
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

  const selectedResumes = useMemo(
    () => resumes.filter((resume) => selectedIds.has(resume.id)),
    [resumes, selectedIds],
  );

  return {
    selectedIds,
    selectedResumes,
    selectResume,
    selectAll,
    clearSelection,
  };
}

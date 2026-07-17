import { useCallback, useMemo, useState } from "react";

type UsePaginatedListOptions<T> = {
  items: T[];
  pageSize?: number;
  filterFn?: (item: T, query: string) => boolean;
  sortFn?: (a: T, b: T) => number;
  query?: string;
};

export function usePaginatedList<T>({
  items,
  pageSize: initialPageSize = 10,
  filterFn,
  sortFn,
  query = "",
}: UsePaginatedListOptions<T>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const filtered = useMemo(() => {
    let result = items;
    if (filterFn && query.trim()) {
      result = result.filter((item) => filterFn(item, query.trim().toLowerCase()));
    }
    if (sortFn) {
      result = [...result].sort(sortFn);
    }
    return result;
  }, [items, filterFn, sortFn, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginated = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const goToPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  const setPageSizeAndReset = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const resetPage = useCallback(() => setPage(1), []);

  return {
    items: paginated,
    total: filtered.length,
    page: safePage,
    pageSize,
    totalPages,
    setPage: goToPage,
    setPageSize: setPageSizeAndReset,
    resetPage,
  };
}

'use client';

import { useEffect, useMemo, useState } from 'react';

export function useGridQuery<T>({
  items,
  pageSize,
  predicate
}: {
  items: T[];
  pageSize: number;
  predicate: (item: T, query: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items;
    }

    return items.filter((item) => predicate(item, normalized));
  }, [items, predicate, query]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [query, items.length, pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  return {
    query,
    setQuery,
    page,
    setPage,
    totalPages,
    totalItems: items.length,
    filteredCount: filteredItems.length,
    pageItems
  };
}

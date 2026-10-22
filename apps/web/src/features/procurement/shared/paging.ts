"use client";

import { useState } from "react";

// Paging for Procurement's document lists (Procurement plan Phase 0, bug 7): quotations, goods receipts, receiving issues, bills and
// returns used to stop at 300 rows. A list asks for one page (limit/offset) and gets the total; the page goes back to the first whenever
// the filters change (`resetKey`), so a narrower filter never lands on an empty page.
export const PAGE_SIZE = 50;

export function usePageIndex(resetKey: unknown) {
  const key = JSON.stringify(resetKey);
  const [state, setState] = useState({ key, index: 0 });
  const pageIndex = state.key === key ? state.index : 0;
  const setPageIndex = (index: number) => setState({ key, index });
  return [pageIndex, setPageIndex] as const;
}

export const pageFilters = (pageIndex: number) => ({ limit: String(PAGE_SIZE), offset: String(pageIndex * PAGE_SIZE) });

// The grid's paging props for a list that came back as { rows, total }.
export function gridPaging(total: number, pageIndex: number, setPageIndex: (index: number) => void) {
  return { pageIndex, pageSize: PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), totalRowCount: total, onPageChange: setPageIndex };
}

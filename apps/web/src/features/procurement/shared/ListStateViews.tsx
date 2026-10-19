"use client";

import { MyViews } from "@/shared/ui/MyViews";

import type { useListState } from "./navigation";

// "My views" for a procurement list kept by useListState: the view, search and filters (not the page) are what is saved.
export function ListStateViews<F extends Record<string, string>>({ listKey, list }: { listKey: string; list: ReturnType<typeof useListState<F>> }) {
  const filters: Record<string, string> = { ...list.filters };
  delete filters.page;
  return <MyViews listKey={`procurement.${listKey}`} state={{ view: list.view, search: list.search, filters }}
    onApply={(saved) => list.apply({ view: saved.view, search: saved.search, filters: { ...(saved.filters as Partial<F>), ...("page" in list.filters ? { page: "0" } : {}) } as Partial<F> })} />;
}

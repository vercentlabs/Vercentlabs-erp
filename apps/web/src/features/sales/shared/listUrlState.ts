"use client";

// A list's view, search, filters, sort and page live in the address (Line-by-line audit, navigation): Back from a record returns to
// the same page of the same view, a filtered list can be bookmarked or sent on WhatsApp, and a home tile that changes ?view= while the
// list is open switches it.
//   ?view=ready_to_invoice&q=steel&f.partyId=…&sort=date&dir=asc&page=3
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SortingState } from "@tanstack/react-table";

type Params = ReturnType<typeof useSearchParams>;

// The initial state, read from the address.
export function readListState<F extends Record<string, string>>(params: Params, defaults: { sort: SortingState; filters: F; view?: string }) {
  const filters = { ...defaults.filters };
  for (const key of Object.keys(filters)) {
    const value = params.get(`f.${key}`);
    if (value !== null) (filters as Record<string, string>)[key] = value;
  }
  const sortId = params.get("sort");
  const page = Math.max(0, (Number(params.get("page")) || 1) - 1);
  return {
    view: params.get("view") || defaults.view || "all",
    search: params.get("q") ?? params.get("search") ?? "",
    filters,
    sorting: sortId ? [{ id: sortId, desc: params.get("dir") !== "asc" }] : defaults.sort,
    pageIndex: page,
  };
}

// Writes the list's state back to the address (replacing the entry, so Back leaves the list), and follows a ?view= changed from
// outside (a home tile, the sidebar) while the list is open.
export function useListUrlState<F extends Record<string, string>>(
  state: { view: string; search: string; filters: F; sorting: SortingState; pageIndex: number },
  defaults: { sort: SortingState; filters: F; view?: string },
  onExternalView: (view: string) => void,
) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const written = useRef<string | null>(null);
  const next = new URLSearchParams();
  if (state.view && state.view !== (defaults.view ?? "all")) next.set("view", state.view);
  if (state.search) next.set("q", state.search);
  for (const [key, value] of Object.entries(state.filters)) if (value !== defaults.filters[key]) next.set(`f.${key}`, value);
  const sort = state.sorting[0];
  const defaultSort = defaults.sort[0];
  if (sort && (sort.id !== defaultSort?.id || sort.desc !== defaultSort?.desc)) { next.set("sort", sort.id); next.set("dir", sort.desc ? "desc" : "asc"); }
  if (state.pageIndex > 0) next.set("page", String(state.pageIndex + 1));
  const query = next.toString();
  useEffect(() => {
    if (query === written.current) return;
    written.current = query;
    const current = params.toString();
    if (current === query) return;
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- writes when the list's own state changes
  }, [query]);
  const outsideView = params.get("view") || defaults.view || "all";
  useEffect(() => {
    if (params.toString() !== written.current && outsideView !== state.view) onExternalView(outsideView);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the address only
  }, [outsideView]);
}

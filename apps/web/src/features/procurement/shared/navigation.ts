"use client";

// Procurement navigation behaviour shared by every list, detail and form:
//   lists   the view is in the URL (?view=…, shareable), and the search and filters are remembered for this browser tab, so returning from a
//           document shows the list as it was left
//   tabs    the open tab is in the URL (?tab=…), so a document's Matching or Payment Schedule tab can be linked to
//   forms   leaving a form with unsaved changes asks first
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function readStored<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the state is simply not remembered */ }
}

function useReplaceParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback((name: string, value: string | null, fallback: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === fallback) next.delete(name);
    else next.set(name, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router]);
}

// The list's view (from ?view=, else the default) and its remembered search and filters.
export function useListState<F extends Record<string, string>>(listKey: string, defaults: { view: string; filters: F }) {
  const params = useSearchParams();
  const replace = useReplaceParam();
  const storageKey = `procurement:list:${listKey}`;
  const [state, setState] = useState(() => {
    const stored = typeof window === "undefined" ? null : readStored<{ search: string; filters: F }>(storageKey);
    return { search: stored?.search ?? "", filters: { ...defaults.filters, ...(stored?.filters ?? {}) } as F };
  });
  useEffect(() => { writeStored(storageKey, state); }, [storageKey, state]);
  const view = params.get("view") ?? defaults.view;
  return {
    view,
    setView: (next: string) => replace("view", next, defaults.view),
    search: state.search,
    setSearch: (search: string) => setState((current) => ({ ...current, search })),
    filters: state.filters,
    setFilter: (key: keyof F, value: string) => setState((current) => ({ ...current, filters: { ...current.filters, [key]: value } })),
    setFilters: (update: (current: F) => F) => setState((current) => ({ ...current, filters: update(current.filters) })),
  };
}

// The open tab of a detail page (?tab=…), limited to the tabs the page has.
export function useTabParam(tabs: readonly string[], fallback: string) {
  const params = useSearchParams();
  const replace = useReplaceParam();
  const requested = params.get("tab");
  const tab = requested && tabs.includes(requested) ? requested : fallback;
  return [tab, (next: string) => replace("tab", next, fallback)] as const;
}

// A form's unsaved changes: the form's values compared with what they were once the form was ready (ready = false while it is still being
// prefilled from its source document), warning before leaving while they differ. Returns whether there are unsaved changes.
export function useFormChangesWarning(value: unknown, ready = true) {
  const snapshot = JSON.stringify(value);
  const [baseline, setBaseline] = useState<string | null>(ready ? snapshot : null);
  if (ready && baseline === null) setBaseline(snapshot);
  const dirty = baseline !== null && snapshot !== baseline;
  useUnsavedChangesWarning(dirty);
  return dirty;
}

// Asks before leaving a page whose form has unsaved changes (closing the tab, reloading or following a link elsewhere).
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const intercept = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.defaultPrevented) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", intercept, true); };
  }, [dirty]);
}

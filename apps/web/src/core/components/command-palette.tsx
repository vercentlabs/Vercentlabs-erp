"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import SemanticNavigationIcon from "@/core/components/semantic-navigation-icon";
import type { QuickCreateAction } from "@/core/quick-create/actions";
import type { ResolvedNavigationWithSettings } from "@/core/navigation/resolve-navigation";
import { moduleIdForPath } from "@/core/navigation/route-map";
import { searchNavigation } from "@/core/search/navigation-search";
import { getRecentDestinations, recordRecentDestination } from "@/core/search/recent";
import type { SearchResult, SearchResultGroup } from "@/core/search/types";

const RECORD_SEARCH_MIN_LENGTH = 2;
const RECORD_SEARCH_DEBOUNCE_MS = 250;
const MAX_ACTIONS_SHOWN = 6;

function quickCreateToResult(action: QuickCreateAction): SearchResult {
  return {
    id: `action:${action.id}`,
    type: "action",
    label: action.label,
    href: action.href,
    icon: action.icon,
    moduleId: action.moduleId,
  };
}

// Ranks context-relevant Quick Create actions first (Part 12) without
// changing which actions are visible — the set was already permission/
// module filtered server-side (resolveQuickCreate); this only reorders it.
function rankQuickCreate(actions: readonly QuickCreateAction[], pathname: string): QuickCreateAction[] {
  const currentModuleId = moduleIdForPath(pathname);
  if (!currentModuleId) return [...actions];
  const contextual = actions.filter((action) => action.moduleId === currentModuleId);
  const rest = actions.filter((action) => action.moduleId !== currentModuleId);
  return [...contextual, ...rest];
}

export default function CommandPalette({
  navigation,
  quickCreate,
  activeCompanyId,
  activeBranchId,
}: {
  navigation: ResolvedNavigationWithSettings;
  quickCreate: QuickCreateAction[];
  activeCompanyId: string | null;
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recordResults, setRecordResults] = useState<SearchResult[]>([]);
  const [recordSearchStatus, setRecordSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const requestTokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Part 39/41 — company/branch context switch invalidates any cached
  // record-search state. React's "adjusting state during render" pattern
  // (not an effect) for the plain-state part — same technique used in
  // sidebar-modules.tsx. Refs cannot be mutated during render at all (the
  // project's stricter React-Compiler-aware ESLint rules enforce this), so
  // in-flight-request invalidation is handled below by making the search
  // effect itself depend on `contextKey` — its cleanup naturally supersedes
  // any request started under the previous context.
  const contextKey = `${activeCompanyId ?? ""}:${activeBranchId ?? ""}`;
  const [lastContextKey, setLastContextKey] = useState(contextKey);
  if (contextKey !== lastContextKey) {
    setLastContextKey(contextKey);
    setRecordResults([]);
    setRecordSearchStatus("idle");
  }

  const navigationResults = useMemo(
    () => (query.trim() ? searchNavigation(navigation, query, 6) : []),
    [navigation, query],
  );

  const rankedQuickCreate = useMemo(() => rankQuickCreate(quickCreate, pathname), [quickCreate, pathname]);

  const actionResults = useMemo(() => {
    const trimmed = query.trim();
    const pool = trimmed
      ? rankedQuickCreate.filter((action) => action.label.toLowerCase().includes(trimmed.toLowerCase()) || action.keywords?.some((k) => k.toLowerCase().includes(trimmed.toLowerCase())))
      : rankedQuickCreate;
    return pool.slice(0, MAX_ACTIONS_SHOWN).map(quickCreateToResult);
  }, [rankedQuickCreate, query]);

  const recentResults = useMemo(() => (query.trim() ? [] : getRecentDestinations(5)), [query]);

  // Clearing record results when the query drops back below the search
  // threshold is fully derivable from `query` at render time, so it's
  // handled here (render-time adjustment) rather than as a synchronous
  // setState inside the effect below.
  const trimmedQuery = query.trim();
  const [lastTrimmedQuery, setLastTrimmedQuery] = useState(trimmedQuery);
  if (trimmedQuery !== lastTrimmedQuery) {
    setLastTrimmedQuery(trimmedQuery);
    if (trimmedQuery.length < RECORD_SEARCH_MIN_LENGTH && recordResults.length > 0) {
      setRecordResults([]);
      setRecordSearchStatus("idle");
    }
  }

  // Server record search — debounced, cancels/ignores stale responses
  // (Part 30), keeps the previous result set visible while a new query is
  // in flight instead of clearing it (Part 22). Re-runs on `contextKey`
  // too, so a company/branch switch mid-query re-searches under the new,
  // correctly-scoped context rather than leaving a stale result set.
  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < RECORD_SEARCH_MIN_LENGTH) {
      return;
    }
    const token = ++requestTokenRef.current;
    debounceRef.current = setTimeout(async () => {
      setRecordSearchStatus("loading");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          headers: { Accept: "application/json" },
        });
        if (token !== requestTokenRef.current) return; // a newer query superseded this one
        if (!response.ok) {
          setRecordSearchStatus("error");
          return;
        }
        const body: { results?: SearchResult[] } = await response.json();
        if (token !== requestTokenRef.current) return;
        setRecordResults(body.results ?? []);
        setRecordSearchStatus("idle");
      } catch {
        if (token !== requestTokenRef.current) return;
        setRecordSearchStatus("error");
      }
    }, RECORD_SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, contextKey]);

  const groups: SearchResultGroup[] = useMemo(() => {
    const list: SearchResultGroup[] = [];
    if (recentResults.length) list.push({ type: "recent", label: "Recent", results: recentResults });
    if (navigationResults.length) list.push({ type: "navigation", label: "Navigation", results: navigationResults });
    if (recordResults.length) list.push({ type: "record", label: "Records", results: recordResults });
    if (actionResults.length) list.push({ type: "action", label: "Actions", results: actionResults });
    return list;
  }, [recentResults, navigationResults, recordResults, actionResults]);

  const flatResults = useMemo(() => groups.flatMap((group) => group.results), [groups]);
  const resultIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flatResults.forEach((result, index) => map.set(result.id, index));
    return map;
  }, [flatResults]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
    requestTokenRef.current += 1;
    lastFocusedRef.current?.focus();
  }, []);

  const openPalette = useCallback(() => {
    lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    setSelectedIndex(0);
    setOpen(true);
  }, []);

  const activate = useCallback(
    (result: SearchResult) => {
      if (result.type !== "action") {
        recordRecentDestination(result);
      }
      closePalette();
      router.push(result.href);
    },
    [closePalette, router],
  );

  // Single global Ctrl/Cmd+K listener (the only one in the app — the old
  // "focus the input" handler in workspace-search.tsx was removed as part
  // of this same change, see docs/implementation/ERP_COMMAND_SURFACE_007.md
  // Section 14 — never two listeners racing for the same shortcut).
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isComposing = (event as unknown as { isComposing?: boolean }).isComposing;
      if (isComposing) return;

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) closePalette();
        else openPalette();
        return;
      }

      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, Math.max(flatResults.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Home" && target === inputRef.current) {
        setSelectedIndex(0);
        return;
      }
      if (event.key === "End" && target === inputRef.current) {
        setSelectedIndex(Math.max(flatResults.length - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selected = flatResults[selectedIndex];
        if (selected) activate(selected);
      }

      // Focus trap: a portaled role="dialog" claims aria-modal="true" but
      // nothing enforced that until now — Tab/Shift+Tab could previously
      // walk a keyboard user straight out into the page behind it. Computed
      // fresh on every Tab press (not cached) since the result list, and
      // therefore the set of focusable elements, changes as the user types.
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;
        if (event.shiftKey && activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!dialogRef.current.contains(activeElement)) {
          // Focus somehow escaped (e.g. a programmatic focus() elsewhere) —
          // pull it back in rather than letting Tab compound the problem.
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, closePalette, openPalette, flatResults, selectedIndex, activate]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Body scroll lock while open — a true modal must not let the page behind
  // it scroll via wheel/touch/keyboard, only the dialog's own results list.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Lets other components (e.g. the mobile bottom navigation's Search
  // action) open the palette without needing direct access to its
  // internal state — matches this file's own existing "single global
  // Ctrl/Cmd+K listener" precedent instead of prop-drilling open-state
  // through unrelated topbar/shell components.
  useEffect(() => {
    function handleExternalOpen() {
      openPalette();
    }
    window.addEventListener("vercentlabs:open-command-palette", handleExternalOpen);
    return () => window.removeEventListener("vercentlabs:open-command-palette", handleExternalOpen);
  }, [openPalette]);

  // Reset selection whenever the query text changes — render-time
  // adjustment (React's documented pattern), not an effect, for the same
  // reason as the context-switch handling above.
  const [lastQueryForSelection, setLastQueryForSelection] = useState(query);
  if (query !== lastQueryForSelection) {
    setLastQueryForSelection(query);
    if (selectedIndex !== 0) setSelectedIndex(0);
  }

  const launcher = (
    <button
      type="button"
      className="global-search"
      onClick={openPalette}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="Search navigation, records and actions"
    >
      <span className="global-search-icon" aria-hidden="true">
        <AppIcon name="search" size={18} />
      </span>
      <span className="global-search-placeholder">Search navigation, records and actions</span>
      <kbd className="search-shortcut" aria-hidden="true">
        Ctrl K
      </kbd>
    </button>
  );

  if (!open) return launcher;

  const dialog = (
    <div className="command-palette-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePalette();
    }}>
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-palette-input-row">
          <AppIcon name="search" size={18} className="command-palette-input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Search navigation, records and actions"
            aria-label="Search navigation, records and actions"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {recordSearchStatus === "loading" ? (
            <span className="command-palette-loading" aria-hidden="true" />
          ) : null}
          <button
            type="button"
            className="command-palette-close"
            onClick={closePalette}
            aria-label="Close command palette"
            title="Close (Esc)"
          >
            <AppIcon name="close" size={16} />
          </button>
        </div>

        <div
          className="command-palette-results"
          onClick={(event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-result-id]");
            const id = button?.dataset.resultId;
            const result = id ? flatResults.find((entry) => entry.id === id) : undefined;
            if (result) activate(result);
          }}
        >
          {groups.length === 0 ? (
            <p className="command-palette-empty">
              {query.trim()
                ? "No matching records or pages. Try another search."
                : "Start typing to search, or jump back into something recent."}
            </p>
          ) : (
            groups.map((group) => (
              <div className="command-palette-group" key={group.type}>
                <p className="command-palette-group-label">{group.label}</p>
                {group.results.map((result) => {
                  const index = resultIndexById.get(result.id) ?? 0;
                  const selected = index === selectedIndex;
                  return (
                    <button
                      type="button"
                      key={result.id}
                      data-result-id={result.id}
                      className={`command-palette-result${selected ? " selected" : ""}`}
                      aria-current={selected ? "true" : undefined}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      {result.icon ? (
                        <span className="command-palette-result-icon" aria-hidden="true">
                          <SemanticNavigationIcon href={result.href} fallback={result.icon} size={17} />
                        </span>
                      ) : null}
                      <span className="command-palette-result-copy">
                        <strong>{result.label}</strong>
                        {result.description ? <small>{result.description}</small> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {recordSearchStatus === "error" ? (
            <p className="command-palette-hint">
              Record search is temporarily unavailable — navigation search still works.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {launcher}
      {typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}

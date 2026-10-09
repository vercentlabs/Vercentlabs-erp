"use client";

// List helpers for screens built on EnterpriseListPage + EnterpriseDataGrid (CRM's list pattern) whose API returns the whole filtered list:
// sorting and paging happen here, so the grid behaves exactly as on a server-paged CRM list (sortable headers, a pager, row counts).
// ColumnsMenu is CRM's "Columns" chooser; the choice is remembered on this device.
import { useEffect, useMemo, useState } from "react";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3 } from "lucide-react";
import {
  ActionBar, BulkActionBar, Button, Checkbox, FilterBar, Popover, PopoverTrigger, SavedViewBar, type ActionBarProps, type BulkActionBarProps, type FilterBarProps, type SavedViewBarProps,
} from "@vercentlabs/design-system";

export const LIST_PAGE_SIZE = 25;

// Typing searches after a short pause, as on CRM lists.
export function useDebouncedValue(value: string, delay = 350) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

const compare = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  const x = typeof a === "number" ? a : Number(a);
  const y = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(x) && Number.isFinite(y) && typeof a !== "boolean") return x - y;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

// sortValue(row, columnId) reads a column's sort key; by default the row field of the same name.
export function usePagedRows<T>(rows: T[], { pageSize = LIST_PAGE_SIZE, initialSorting = [], sortValue }: {
  pageSize?: number; initialSorting?: SortingState; sortValue?: (row: T, columnId: string) => unknown;
} = {}) {
  const [sorting, setSortingState] = useState<SortingState>(initialSorting);
  const [requestedPage, setPageIndex] = useState(0);
  const sorted = useMemo(() => {
    const rule = sorting[0];
    if (!rule) return rows;
    const read = sortValue ?? ((row: T, id: string) => (row as Record<string, unknown>)[id]);
    const direction = rule.desc ? -1 : 1;
    return [...rows].sort((a, b) => compare(read(a, rule.id), read(b, rule.id)) * direction);
  }, [rows, sorting, sortValue]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  // A narrower filter can leave the page past the end: show its last page.
  const pageIndex = Math.min(requestedPage, pageCount - 1);
  return {
    pageRows: sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    grid: {
      manualSorting: true, sorting, onSortingChange: (next: SortingState) => { setSortingState(next); setPageIndex(0); },
      pageIndex, pageSize, pageCount, totalRowCount: sorted.length, onPageChange: setPageIndex,
    },
    resetPage: () => setPageIndex(0),
  };
}

export type OptionalColumn = { id: string; label: string; hiddenByDefault?: boolean };

export function useColumnVisibility(storageKey: string, columns: OptionalColumn[]) {
  const defaults: VisibilityState = Object.fromEntries(columns.map((column) => [column.id, !column.hiddenByDefault]));
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    } catch {
      return defaults;
    }
  });
  const change = (next: VisibilityState) => {
    setVisibility(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Column choices are a convenience; nothing to do if storage is unavailable.
    }
  };
  return { visibility, setVisibility: change, columns };
}

export function ColumnsMenu({ columns, visibility, onChange }: { columns: OptionalColumn[]; visibility: VisibilityState; onChange: (next: VisibilityState) => void }) {
  return (
    <PopoverTrigger>
      <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" />Columns</Button>
      <Popover>
        <div className="flex flex-col gap-2 p-1">
          <p className="text-xs font-medium text-text-secondary">Show columns</p>
          {columns.map((column) => (
            <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => onChange({ ...visibility, [column.id]: checked })}>{column.label}</Checkbox>
          ))}
        </div>
      </Popover>
    </PopoverTrigger>
  );
}

// The active-filter chips under a list's toolbar (CRM's FilterBar): one per filter that is set, each removable, and Clear all.
export type FilterChip = { id: string; active: boolean; label: string; clear: () => void };
export function filterBarOf(chips: FilterChip[], afterChange?: () => void) {
  const active = chips.filter((chip) => chip.active);
  if (!active.length) return undefined;
  return {
    filters: active.map((chip) => ({ id: chip.id, label: chip.label })),
    onRemove: (id: string) => { active.find((chip) => chip.id === id)?.clear(); afterChange?.(); },
    onClearAll: () => { active.forEach((chip) => chip.clear()); afterChange?.(); },
  };
}

// The short label of an option, for a filter chip: its name (or its code, for warehouses and locations).
export const optionLabel = (list: Array<{ id: string; code?: string; name?: string; label?: string }> | undefined, id: string, prefer: "name" | "code" = "name") => {
  const found = list?.find((entry) => entry.id === id);
  if (!found) return id;
  return (prefer === "code" ? found.code ?? found.label ?? found.name : found.label ?? found.name ?? found.code) ?? id;
};

// The toolbar card of EnterpriseListPage, for a list inside a page (a view of a workspace that already has its header): saved views, the
// action bar (or the bulk-action bar while rows are selected) and the active-filter chips, in the same surface and spacing.
export function ListToolbar({ savedViews, actionBar, bulkActionBar, filterBar }: {
  savedViews?: SavedViewBarProps; actionBar?: ActionBarProps; bulkActionBar?: BulkActionBarProps; filterBar?: FilterBarProps;
}) {
  if (!savedViews && !actionBar && !bulkActionBar && !filterBar) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-subtle)]">
      {savedViews && <SavedViewBar {...savedViews} />}
      {bulkActionBar && bulkActionBar.selectedCount > 0 ? <BulkActionBar {...bulkActionBar} /> : actionBar ? <ActionBar {...actionBar} /> : null}
      {filterBar && <FilterBar {...filterBar} />}
    </div>
  );
}

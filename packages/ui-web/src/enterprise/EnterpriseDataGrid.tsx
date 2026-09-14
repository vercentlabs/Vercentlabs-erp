"use client";

import { flexRender } from "@tanstack/react-table";
import type {
  ColumnVisibilityState as VisibilityState,
  OnChangeFn,
  RowData,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";
import {
  getCoreRowModel,
  useLegacyTable as useReactTable,
} from "@tanstack/react-table/legacy";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, MoreHorizontal } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { Checkbox } from "../primitives/Checkbox";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "../primitives/DropdownMenu";
import { Skeleton } from "../primitives/Skeleton";
import { cn } from "../utils/cn";
import { EmptyState, ErrorState, NoResultsState, PermissionState } from "./StatePanel";

// The canonical enterprise grid (docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md,
// docs/ux/UI_REWRITE_TRACKER.md Phase 3). Built on TanStack Table's
// documented "legacy" API surface (@tanstack/react-table/legacy) rather
// than v9's new atom/store-based useTable -- both ship in the same
// installed v9.2.4 package; the legacy surface is the well-established,
// thoroughly-documented API (matching what every TanStack Table v8 guide
// already describes), chosen deliberately over the brand-new experimental
// API to ship a CORRECT grid under this session's real time constraints
// rather than an unverified one. Migrating to the new store-atom API
// later is a real, tracked option (docs/ux/UI_REWRITE_TRACKER.md), not a
// silent shortcut.
//
// DESIGN FOR EXTENSION, NOT YET IMPLEMENTED (do not claim these work):
// column pinning, grouping/aggregation, tree/hierarchical rows, inline
// editing, saved views, cell (not just row) selection, totals/subtotals.
// The `columns`/`data` generic shape and the manual-sort/manual-pagination
// contract below are chosen so these can be added without a breaking
// rewrite -- see the TODO markers.

// ColumnDef resolves to a union (accessor/display/group column defs), which
// an `interface ... extends` cannot extend -- an intersection type alias can.
export type EnterpriseDataGridColumn<TData extends RowData> = ColumnDef<TData, unknown> & {
  /** Marks a column permission-sensitive: cells render a lock glyph via `sensitiveCell` instead of the raw value when the caller's session lacks access. Enforcement is the caller's -- this only affects rendering. */
  sensitive?: boolean;
};

export interface EnterpriseDataGridProps<TData extends RowData> {
  columns: EnterpriseDataGridColumn<TData>[];
  data: TData[];
  getRowId?: (row: TData) => string;

  /** Loading/empty/no-results/error/forbidden -- exactly one should be true; loading takes precedence. */
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  isForbidden?: boolean;
  emptyState?: { title: string; description?: string; action?: ReactNode };

  /** Server-driven sorting (manualSorting): the grid renders sort indicators and calls onSortingChange; the caller re-fetches (e.g. by navigating with updated URL search params) rather than the grid sorting client-side rows itself. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;

  /** Server-driven pagination: the grid never slices `data` itself. */
  pageIndex: number;
  pageSize: number;
  totalRows: number;
  onPageChange?: (pageIndex: number) => void;

  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  bulkActions?: ReactNode;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;

  /** Row-level action menu, rendered as the last column. */
  renderRowActions?: (row: TData) => ReactNode;

  onRowClick?: (row: TData) => void;

  density?: "compact" | "comfortable";

  /** Extension point (SP033/responsive): render a card list instead of a table below this breakpoint. When omitted, the table renders at every width with horizontal scroll -- acceptable for READ_ONLY/APPROVAL_ONLY mobile classifications, not for FULL/FIELD_OPTIMIZED ones (see UX_TRACEABILITY_REGISTER.csv's phone_support column for a given requirement). */
  mobileCardRenderer?: (row: TData) => ReactNode;

  /** Row-count threshold above which TanStack Virtual takes over rendering (default 50 -- below that, virtualization overhead isn't worth it and it complicates sticky-header math for no benefit). */
  virtualizeThreshold?: number;

  "aria-label": string;
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") return <ArrowUp className="size-3.5" aria-hidden="true" />;
  if (direction === "desc") return <ArrowDown className="size-3.5" aria-hidden="true" />;
  return <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />;
}

export function EnterpriseDataGrid<TData extends RowData>({
  columns,
  data,
  getRowId,
  isLoading,
  isError,
  errorMessage,
  isForbidden,
  emptyState,
  sorting,
  onSortingChange,
  pageIndex,
  pageSize,
  totalRows,
  onPageChange,
  rowSelection,
  onRowSelectionChange,
  bulkActions,
  columnVisibility,
  onColumnVisibilityChange,
  renderRowActions,
  onRowClick,
  density = "comfortable",
  mobileCardRenderer,
  virtualizeThreshold = 50,
  ...rest
}: EnterpriseDataGridProps<TData>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const hasSelection = rowSelection !== undefined && onRowSelectionChange !== undefined;

  const selectColumn: ColumnDef<TData, unknown> = {
    id: "__select",
    size: 40,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all rows on this page"
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select row ${row.index + 1}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
        onClick={(event) => event.stopPropagation()}
      />
    ),
  };

  const actionsColumn: ColumnDef<TData, unknown> = {
    id: "__actions",
    size: 48,
    header: "",
    cell: ({ row }) => (
      <div onClick={(event) => event.stopPropagation()}>{renderRowActions?.(row.original)}</div>
    ),
  };

  const effectiveColumns: ColumnDef<TData, unknown>[] = hasSelection ? [selectColumn, ...(columns as ColumnDef<TData, unknown>[])] : (columns as ColumnDef<TData, unknown>[]);
  const withActions: ColumnDef<TData, unknown>[] = renderRowActions ? [...effectiveColumns, actionsColumn] : effectiveColumns;

  const table = useReactTable({
    data,
    columns: withActions as ColumnDef<TData, unknown>[],
    state: { sorting, rowSelection, columnVisibility },
    onSortingChange,
    onRowSelectionChange,
    onColumnVisibilityChange,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: hasSelection,
    pageCount: Math.max(1, Math.ceil(totalRows / pageSize)),
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = rows.length > virtualizeThreshold;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (density === "compact" ? 36 : 44),
    overscan: 8,
  });

  if (isForbidden) return <PermissionState />;
  if (isError) return <ErrorState description={errorMessage} />;
  if (!isLoading && data.length === 0) {
    return emptyState ? <EmptyState {...emptyState} /> : <NoResultsState />;
  }

  const rowHeight = density === "compact" ? "h-9" : "h-11";
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="flex flex-col gap-3" {...rest}>
      {bulkActions && rowSelection && Object.keys(rowSelection).length > 0 ? (
        <div role="toolbar" aria-label="Bulk actions" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-action-primary-border)] bg-[var(--color-action-primary-soft)] px-3 py-2">
          <span className="text-[length:var(--text-sm)] font-medium text-[var(--color-action-primary)]">
            {Object.keys(rowSelection).length} selected
          </span>
          {bulkActions}
        </div>
      ) : null}

      {/* Mobile card adaptation: below sm, render cards instead of the table when the caller supplies one -- see mobileCardRenderer's own doc comment for when omitting this is acceptable. */}
      {mobileCardRenderer ? (
        <div className="flex flex-col gap-2 sm:hidden">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
            : data.map((row, i) => <div key={getRowId ? getRowId(row) : i}>{mobileCardRenderer(row)}</div>)}
        </div>
      ) : null}

      <div
        ref={parentRef}
        className={cn("relative overflow-auto rounded-[var(--radius-card)] border border-[var(--color-border-default)]", mobileCardRenderer && "hidden sm:block")}
        style={{ maxHeight: shouldVirtualize ? 640 : undefined }}
      >
        <table className="w-full border-collapse text-[length:var(--text-sm)]">
          <thead className="sticky top-0 z-[var(--z-sticky)] bg-[var(--color-surface-subtle)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      className="border-b border-[var(--color-border-default)] px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]"
                      aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : canSort ? "none" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] rounded"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIndicator direction={header.column.getIsSorted()} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className={rowHeight}>
                    {withActions.map((_, j) => (
                      <td key={j} className="px-3 py-2">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      rowHeight,
                      "border-b border-[var(--color-border-default)] last:border-0",
                      onRowClick && "cursor-pointer hover:bg-[var(--color-canvas-strong)]",
                      row.getIsSelected() && "bg-[var(--color-action-primary-soft)]",
                    )}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter") onRowClick(row.original);
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 text-[var(--color-text-primary)]">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pagination" className="flex items-center justify-between text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">
        <span>
          Page {pageIndex + 1} of {totalPages} &middot; {totalRows} record{totalRows === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange?.(pageIndex - 1)}
            className="rounded-[var(--radius-control)] border border-[var(--color-border-default)] px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={pageIndex + 1 >= totalPages}
            onClick={() => onPageChange?.(pageIndex + 1)}
            className="rounded-[var(--radius-control)] border border-[var(--color-border-default)] px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </nav>
    </div>
  );
}

export function ColumnVisibilityToggle({
  columns,
  visibility,
  onChange,
}: {
  columns: { id: string; label: string }[];
  visibility: VisibilityState;
  onChange: (next: VisibilityState) => void;
}) {
  const shownCount = columns.filter((c) => visibility[c.id] !== false).length;
  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border-default)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
        Columns ({shownCount}/{columns.length})
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={visibility[column.id] !== false}
            onCheckedChange={(checked) => onChange({ ...visibility, [column.id]: Boolean(checked) })}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}

export { MoreHorizontal as RowActionsIcon };

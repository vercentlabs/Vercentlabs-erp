import { useMemo, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "../../data-entry/Checkbox.tsx";
import { Skeleton } from "../../data-display/Skeleton.tsx";
import { EmptyState, NoResultsState, ErrorState, PermissionState } from "../../data-display/states.tsx";
import { Pagination } from "../../navigation/Pagination.tsx";
import { cn } from "../../utilities/cn.ts";
import type { EnterpriseDataGridProps } from "./types.ts";

const SELECT_COLUMN_ID = "__select";
const ACTIONS_COLUMN_ID = "__actions";

/**
 * The shared production foundation every module's list screen builds on.
 * Server-side sorting/pagination/filtering are contracts (the grid emits
 * intent, the caller's query owns the actual fetch) — this component never
 * silently resorts/repaginates data behind a manual-mode flag.
 */
export function EnterpriseDataGrid<TRow>({
  className,
  columns,
  data,
  getRowId,
  state = "ready",
  loadingContent,
  emptyContent,
  noResultsContent,
  errorContent,
  permissionDeniedContent,
  sorting,
  onSortingChange,
  manualSorting = sorting !== undefined,
  pageIndex = 0,
  pageSize = 20,
  pageCount,
  onPageChange,
  totalRowCount,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  onColumnVisibilityChange,
  enableColumnResizing = false,
  density = "comfortable",
  rowActions,
  onRowClick,
  virtualize = false,
  estimateRowHeight = 40,
  renderMobileCard,
  ...ariaProps
}: EnterpriseDataGridProps<TRow>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const resolvedColumns = useMemo<ColumnDef<TRow, unknown>[]>(() => {
    const cols: ColumnDef<TRow, unknown>[] = [...columns];
    if (enableRowSelection) {
      cols.unshift({
        id: SELECT_COLUMN_ID,
        size: 40,
        enableResizing: false,
        header: ({ table }) => (
          // Selecting a row must never also trigger the row's own onRowClick
          // navigation — the checkbox's native click bubbles to the <tr>
          // otherwise, since AriaCheckbox renders a real clickable label.
          <span onClick={(event) => event.stopPropagation()}>
            <Checkbox
              aria-label="Select all rows"
              isSelected={table.getIsAllRowsSelected()}
              isIndeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
              onChange={(checked) => table.toggleAllRowsSelected(checked)}
            />
          </span>
        ),
        cell: ({ row }) => (
          <span onClick={(event) => event.stopPropagation()}>
            <Checkbox
              aria-label={`Select row ${row.id}`}
              isSelected={row.getIsSelected()}
              isDisabled={!row.getCanSelect()}
              onChange={(checked) => row.toggleSelected(checked)}
            />
          </span>
        ),
      });
    }
    if (rowActions) {
      cols.push({
        id: ACTIONS_COLUMN_ID,
        size: 56,
        enableResizing: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => rowActions(row.original),
      });
    }
    return cols;
  }, [columns, enableRowSelection, rowActions]);

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: {
      ...(sorting !== undefined ? { sorting } : {}),
      ...(rowSelection !== undefined ? { rowSelection } : {}),
      ...(columnVisibility !== undefined ? { columnVisibility } : {}),
      ...(pageCount !== undefined ? { pagination: { pageIndex, pageSize } } : {}),
    },
    onSortingChange: onSortingChange ? (updater) => onSortingChange(typeof updater === "function" ? updater(sorting ?? []) : updater) : undefined,
    manualSorting,
    enableRowSelection,
    onRowSelectionChange: onRowSelectionChange ? (updater) => onRowSelectionChange(typeof updater === "function" ? updater(rowSelection ?? {}) : updater) : undefined,
    onColumnVisibilityChange: onColumnVisibilityChange
      ? (updater) => onColumnVisibilityChange(typeof updater === "function" ? updater(columnVisibility ?? {}) : updater)
      : undefined,
    manualPagination: true,
    pageCount: pageCount ?? -1,
    columnResizeMode: enableColumnResizing ? "onChange" : undefined,
    enableColumnResizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: pageCount !== undefined ? undefined : getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
    enabled: virtualize,
  });

  const rowPaddingClass = density === "compact" ? "py-1.5" : "py-2.5";
  const gridId = ariaProps["aria-label"];

  if (state !== "ready") {
    return (
      <div className={cn("rounded-[var(--radius-card)] border border-border bg-surface", className)}>
        {state === "loading" && (loadingContent ?? <GridSkeleton columnCount={resolvedColumns.length} />)}
        {state === "empty" && (emptyContent ?? <EmptyState title="No records yet" />)}
        {state === "no-results" && (noResultsContent ?? <NoResultsState title="No matches" />)}
        {state === "error" && (errorContent ?? <ErrorState title="Couldn't load data" />)}
        {state === "permission-denied" && (permissionDeniedContent ?? <PermissionState title="You don't have access" />)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn("rounded-[var(--radius-card)] border border-border bg-surface", className)}>
        {noResultsContent ?? <NoResultsState title="No matches" />}
      </div>
    );
  }

  const table_ = (
    <div className={cn("overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface", className)}>
      <div ref={scrollRef} className="max-h-[70vh] overflow-auto" tabIndex={0} role="group" aria-label={gridId}>
        {/* Fixed pixel widths (getTotalSize/getSize) only matter once
            column resizing is actually enabled — otherwise TanStack's
            150px-per-column default forces horizontal scroll even for
            narrow content (a Priority badge, a Score number). Left to the
            browser's normal table layout, columns size to their content. */}
        <table
          className="w-full border-collapse text-sm"
          style={enableColumnResizing ? { width: table.getTotalSize() } : undefined}
        >
          <thead className="sticky top-0 z-[var(--z-sticky)] bg-surface-raised">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      style={enableColumnResizing ? { width: header.getSize() } : undefined}
                      className="relative px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-text-muted uppercase"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex items-center gap-1 outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === "asc" && <ArrowUp className="size-3" aria-hidden="true" />}
                          {sortDir === "desc" && <ArrowDown className="size-3" aria-hidden="true" />}
                          {!sortDir && <ChevronsUpDown className="size-3 text-text-subtle" aria-hidden="true" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-brand"
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <VirtualOrPlainBody rows={rows} virtualizer={virtualize ? virtualizer : null} onRowClick={onRowClick} rowPaddingClass={rowPaddingClass} />
        </table>
      </div>
      {pageCount !== undefined && onPageChange !== undefined && (
        <div className="border-t border-border px-3 py-2">
          <Pagination page={pageIndex + 1} pageCount={pageCount} onPageChange={(p) => onPageChange(p - 1)} totalItems={totalRowCount} pageSize={pageSize} />
        </div>
      )}
    </div>
  );

  if (!renderMobileCard) return table_;

  return (
    <>
      <div className="hidden md:block">{table_}</div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>{renderMobileCard(row.original)}</li>
        ))}
      </ul>
    </>
  );
}

function GridSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columnCount }).map((_, colIndex) => (
            <Skeleton key={colIndex} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function VirtualOrPlainBody<TRow>({
  rows,
  virtualizer,
  onRowClick,
  rowPaddingClass,
}: {
  rows: Row<TRow>[];
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null;
  onRowClick?: (row: TRow) => void;
  rowPaddingClass: string;
}) {
  if (!virtualizer) {
    return (
      <tbody>
        {rows.map((row) => (
          <GridRow key={row.id} row={row} onRowClick={onRowClick} rowPaddingClass={rowPaddingClass} />
        ))}
      </tbody>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <tbody>
      {paddingTop > 0 && (
        <tr aria-hidden="true">
          <td style={{ height: paddingTop }} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => (
        <GridRow key={rows[virtualRow.index].id} row={rows[virtualRow.index]} onRowClick={onRowClick} rowPaddingClass={rowPaddingClass} />
      ))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td style={{ height: paddingBottom }} />
        </tr>
      )}
    </tbody>
  );
}

function GridRow<TRow>({ row, onRowClick, rowPaddingClass }: { row: Row<TRow>; onRowClick?: (row: TRow) => void; rowPaddingClass: string }) {
  const resizable = row.getVisibleCells().some((cell) => cell.column.getCanResize());
  return (
    <tr
      data-selected={row.getIsSelected() || undefined}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={cn(
        "border-b border-border last:border-b-0 transition-colors",
        "hover:bg-surface-muted data-[selected]:bg-brand-soft",
        onRowClick && "cursor-pointer",
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className={cn("px-4 text-text", rowPaddingClass)}
          style={resizable ? { width: cell.column.getSize() } : undefined}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

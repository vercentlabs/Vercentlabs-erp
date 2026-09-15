import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import type { ReactNode } from "react";

export type GridState = "loading" | "empty" | "no-results" | "error" | "permission-denied" | "ready";
export type GridDensity = "compact" | "comfortable";

export interface EnterpriseDataGridProps<TRow> {
  className?: string;
  columns: ColumnDef<TRow, unknown>[];
  data: TRow[];
  getRowId?: (row: TRow) => string;

  /** Which non-"ready" surface to show, or "ready" for the real grid. Only
   * one of loading/empty/no-results/error/permission-denied is ever true
   * at once — this isn't a set of independent booleans a caller could
   * contradict. */
  state?: GridState;
  loadingContent?: ReactNode;
  emptyContent?: ReactNode;
  noResultsContent?: ReactNode;
  errorContent?: ReactNode;
  permissionDeniedContent?: ReactNode;

  /** Server-side sorting: pass `sorting` + `onSortingChange` and the grid
   * renders sort indicators/handles the click but does not resort `data`
   * itself. Omit both for client-side sorting instead. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  manualSorting?: boolean;

  /** Server-side pagination contract — `pageCount` is the backend's total,
   * `pageIndex`/`pageSize` are 0-based/row-count. */
  pageIndex?: number;
  pageSize?: number;
  pageCount?: number;
  onPageChange?: (pageIndex: number) => void;
  totalRowCount?: number;

  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;

  enableColumnResizing?: boolean;

  density?: GridDensity;

  /** Row-level actions rendered in a trailing column — a MenuTrigger, an
   * IconButton, whatever the feature needs. Receives the row's original
   * data. */
  rowActions?: (row: TRow) => ReactNode;

  onRowClick?: (row: TRow) => void;

  /** Enables virtualization for large row counts. Omit for small/paged
   * result sets where virtualization adds complexity without benefit. */
  virtualize?: boolean;
  estimateRowHeight?: number;

  /** Opt-in responsive fallback — renders this instead of the table under
   * the `md` breakpoint. Omit to let the table scroll horizontally on
   * narrow viewports instead (acceptable for dense admin tables; provide
   * this when the table is a primary mobile workflow). */
  renderMobileCard?: (row: TRow) => ReactNode;

  "aria-label": string;
}

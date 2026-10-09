"use client";

// Opening Stock: the documents that brought in the stock the company owned before Vercentlabs, one warehouse and cutoff each. Views: All,
// Draft, Posted, Cancelled, Reversed and Migration batches (every file checked or imported). Value is shown only to those who may see cost;
// item count rather than a sum of mixed units.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, MetricCard, NoResultsState, PermissionState, SearchField, Select, StatusBadge,
} from "@vercentlabs/design-system";

import { money } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  errorCode, errorMessage, getOpeningOptions, getReconciliation, listMigrationBatches, listOpeningStocks, type MigrationBatch, type OpeningStatus, type OpeningSummary,
} from "../api/opening-stock-api";

export const OPENING_BASE = "/inventory/opening-stock";
const VIEWS = [{ id: "all", label: "All" }, { id: "draft", label: "Draft" }, { id: "posted", label: "Posted" }, { id: "cancelled", label: "Cancelled" },
  { id: "reversed", label: "Reversed" }, { id: "imports", label: "Migration batches" }];
const ANY = "any";
export const STATUS_TONE: Record<OpeningStatus, "neutral" | "success" | "warning" | "info"> = { draft: "info", posted: "success", cancelled: "neutral", reversed: "warning" };
const BATCH_STATUS: Record<string, { label: string; tone: "success" | "danger" | "info" }> = {
  applied: { label: "Imported", tone: "success" }, rejected: { label: "Rejected", tone: "danger" },
};

export function OpeningStockListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const filters = { view: view === "imports" ? undefined : view, search: submitted || undefined, warehouseId: warehouseId === ANY ? undefined : warehouseId };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "list", filters), queryFn: () => listOpeningStocks(filters), enabled: view !== "imports", placeholderData: (previous) => previous });
  const batches = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "imports"), queryFn: listMigrationBatches, enabled: view === "imports" });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "options"), queryFn: getOpeningOptions, staleTime: 60_000 });
  const can = options.data?.capabilities ?? list.data?.capabilities;
  const recon = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "reconciliation"), queryFn: getReconciliation, enabled: Boolean(can?.reconcile) });
  const rows = useMemo(() => list.data?.documents ?? [], [list.data]);
  const batchRows = useMemo(() => batches.data ?? [], [batches.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "openingDate", desc: true }] });
  const pagedBatches = usePagedRows(batchRows, { initialSorting: [{ id: "uploadedAt", desc: true }] });
  const showValue = Boolean(can?.viewCost);

  const documentColumns = useMemo(() => ([
    { id: "number", accessorKey: "number", header: "Opening stock", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "warehouseCode", accessorKey: "warehouseCode", header: "Warehouse", cell: ({ row }) => `${row.original.warehouseCode} · ${row.original.warehouseName}` },
    { id: "openingDate", accessorKey: "openingDate", header: "Opening date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.openingDate)}</span> },
    { id: "items", accessorKey: "items", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.items}</span> },
    { id: "value", accessorKey: "value", header: "Inventory value", cell: ({ row }) => <span className="tabular-nums">{money(row.original.value ?? 0)}</span> },
    { id: "migrationReference", accessorKey: "migrationReference", header: "Migration reference", cell: ({ row }) => row.original.migrationReference },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "createdBy", accessorKey: "createdBy", header: "Created by", cell: ({ row }) => row.original.createdBy ?? "" },
  ] satisfies ColumnDef<OpeningSummary, unknown>[]).filter((column) => showValue || column.id !== "value"), [showValue]);
  const batchColumns = useMemo<ColumnDef<MigrationBatch, unknown>[]>(() => [
    { id: "fileName", accessorKey: "fileName", header: "File", cell: ({ row }) => <span className="font-medium text-text">{row.original.fileName}</span> },
    { id: "documentNumber", accessorKey: "documentNumber", header: "Document", cell: ({ row }) => row.original.documentNumber ?? "" },
    { id: "warehouseCode", accessorKey: "warehouseCode", header: "Warehouse", cell: ({ row }) => row.original.warehouseCode },
    { id: "migrationReference", accessorKey: "migrationReference", header: "Migration reference", cell: ({ row }) => row.original.migrationReference },
    { id: "rows", accessorKey: "rows", header: "Rows", cell: ({ row }) => <span className="tabular-nums">{row.original.rows}</span> },
    { id: "warnings", accessorKey: "warnings", header: "Warnings", cell: ({ row }) => <span className="tabular-nums">{row.original.warnings}</span> },
    { id: "errors", accessorKey: "errors", header: "Errors", cell: ({ row }) => <span className="tabular-nums">{row.original.errors}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => {
      const status = BATCH_STATUS[row.original.status] ?? { label: "Checked", tone: "info" as const };
      return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
    } },
    { id: "uploadedAt", accessorKey: "uploadedAt", header: "Uploaded", cell: ({ row }) => `${formatDateTime(row.original.uploadedAt)}${row.original.uploadedBy ? ` · ${row.original.uploadedBy}` : ""}` },
  ], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to opening stock" description="Ask an administrator for access." />;
  const filterBar = view === "imports" ? undefined : filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(options.data?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "all";

  return (
    <EnterpriseListPage
      header={{
        title: "Opening Stock",
        description: "The stock the company already owned when it started on Vercentlabs, loaded per warehouse at a cutoff date. After go-live, stock changes through receipts, deliveries, transfers and adjustments.",
        primaryAction: can?.prepare ? <LinkButton href={`${OPENING_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New opening stock</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={view === "imports" ? undefined : {
        start: (
          <>
            <SearchField aria-label="Search opening stock" placeholder="Number, reference or warehouse" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
              options={[{ value: ANY, label: "Any warehouse" }, ...(options.data?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      {recon.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Inventory opening value" value={money(recon.data.inventoryValue)} />
          <MetricCard label="Finance opening inventory" value={money(recon.data.financeValue)} />
          <MetricCard label="Difference" value={money(recon.data.difference)} />
          <div className="flex items-center"><StatusBadge tone={recon.data.status === "reconciled" ? "success" : "warning"}>{recon.data.label}</StatusBadge></div>
        </div>
      )}
      {view === "imports" ? (
        <EnterpriseDataGrid<MigrationBatch>
          aria-label="Migration batches"
          columns={batchColumns}
          data={pagedBatches.pageRows}
          getRowId={(row) => row.id}
          state={batches.isLoading ? "loading" : batches.isError ? "error" : batchRows.length === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading migration batches" rows={6} />}
          errorContent={<ErrorState title="Could not load migration batches" description={errorMessage(batches.error)} action={{ label: "Try again", onPress: () => void batches.refetch() }} />}
          emptyContent={<EmptyState title="No files imported yet" description="Import a spreadsheet from an opening stock draft." />}
          {...pagedBatches.grid}
          onRowClick={(row) => row.documentId && router.push(`${OPENING_BASE}/${row.documentId}?tab=imports`)}
        />
      ) : (
        <EnterpriseDataGrid<OpeningSummary>
          aria-label="Opening stock"
          columns={documentColumns}
          data={paged.pageRows}
          getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading opening stock" rows={8} />}
          errorContent={<ErrorState title="Could not load opening stock" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="No opening stock yet" description="Load each warehouse's stock at your go-live cutoff, typed in or imported from a spreadsheet."
            action={can?.prepare ? { label: "New opening stock", onPress: () => router.push(`${OPENING_BASE}/new`) } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or warehouse." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`${OPENING_BASE}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.warehouseCode} · {formatDate(row.openingDate)} · {row.items} items</span>
            </div>
          )}
        />
      )}
    </EnterpriseListPage>
  );
}

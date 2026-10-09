"use client";

// Stock Counts: physical inventory of a warehouse, some locations or some items, counted against the stock captured when the count starts. While a
// count is open its scope is frozen; completing it posts the confirmed variances as one Stock Adjustment. A count never moves stock itself.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { money } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { ColumnsMenu, filterBarOf, optionLabel, useColumnVisibility, useDebouncedValue, usePagedRows, type OptionalColumn } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_TONE, STOCK_COUNTS_BASE, errorCode, errorMessage, getCountOptions, listCounts, type CountHeader } from "../api/stock-counts-api";

const ANY = "any";
const VIEWS = [{ id: ANY, label: "All" }, { id: "draft", label: "Draft" }, { id: "in_progress", label: "In progress" }, { id: "ready_for_review", label: "Ready for review" },
  { id: "completed", label: "Completed" }, { id: "cancelled", label: "Cancelled" }];
const OPTIONAL: OptionalColumn[] = [
  { id: "snapshotAt", label: "Snapshot" }, { id: "progress", label: "Progress" }, { id: "varianceLines", label: "Variance lines" }, { id: "valueNet", label: "Value variance" },
  { id: "assignedUserName", label: "Counter" }, { id: "completedAt", label: "Completed" },
];

export function StockCountsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? ANY);
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const [countType, setCountType] = useState(ANY);
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = { view: pick(view), search: submitted || undefined, warehouseId: pick(warehouseId), countType: pick(countType) };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "stock-counts", "options"), queryFn: getCountOptions, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "stock-counts", "list", filters), queryFn: () => listCounts(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "number", desc: true }] });
  const columns = useColumnVisibility("inventory.stock-counts.columns", OPTIONAL);
  const seesValue = Boolean(list.data?.seesValue);

  const gridColumns = useMemo(() => ([
    { id: "number", accessorKey: "number", header: "Count", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>
        {row.original.reference ? <span className="text-xs text-text-muted">{row.original.reference}</span> : null}</span>
    ) },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "countTypeLabel", accessorKey: "countTypeLabel", header: "Scope", cell: ({ row }) => <>{row.original.countTypeLabel}{row.original.blindCount ? <span className="text-xs text-text-muted"> · blind</span> : null}</> },
    { id: "snapshotAt", accessorKey: "snapshotAt", header: "Snapshot", cell: ({ row }) => (row.original.snapshotAt ? formatDateTime(row.original.snapshotAt) : "") },
    { id: "progress", accessorKey: "progress", header: "Progress", cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount ? `${row.original.countedLines} / ${row.original.lineCount} (${row.original.progress}%)` : "—"}</span> },
    { id: "varianceLines", accessorKey: "varianceLines", header: "Variance lines", cell: ({ row }) => <span className="tabular-nums">{row.original.status === "draft" ? "—" : row.original.varianceLines}</span> },
    { id: "valueNet", accessorKey: "valueNet", header: "Value variance", cell: ({ row }) => <span className="tabular-nums">{row.original.valueNet === undefined ? "—" : money(row.original.valueNet)}</span> },
    { id: "assignedUserName", accessorKey: "assignedUserName", header: "Counter", cell: ({ row }) => row.original.assignedUserName ?? "" },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "completedAt", accessorKey: "completedAt", header: "Completed", cell: ({ row }) => (row.original.completedAt ? formatDateTime(row.original.completedAt) : "") },
  ] satisfies ColumnDef<CountHeader, unknown>[]).filter((column) => seesValue || column.id !== "valueNet"), [seesValue]);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to stock counts" description="Ask an administrator for the View stock counts permission." />;
  const o = options.data;
  const filterBar = filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
    { id: "scope", active: countType !== ANY, label: `Scope: ${optionLabel(o?.countTypes, countType)}`, clear: () => setCountType(ANY) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== ANY;
  const canCreate = list.data?.canCreate;

  return (
    <EnterpriseListPage
      header={{
        title: "Stock Counts",
        description: "Count what is physically in a warehouse, some locations or some items. Starting a count captures the system stock and freezes its scope; completing it posts the confirmed differences as one stock adjustment.",
        primaryAction: canCreate ? <LinkButton href={`${STOCK_COUNTS_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New stock count</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search counts" placeholder="Number or reference" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
              options={[{ value: ANY, label: "Any warehouse" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
            <Select aria-label="Scope" size="compact" selectedKey={countType} onSelectionChange={(key) => setCountType(String(key))}
              options={[{ value: ANY, label: "Any scope" }, ...(o?.countTypes ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
          </>
        ),
        end: <ColumnsMenu columns={OPTIONAL.filter((column) => seesValue || column.id !== "valueNet")} visibility={columns.visibility} onChange={columns.setVisibility} />,
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<CountHeader>
        aria-label="Stock counts"
        columns={gridColumns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading stock counts" rows={8} />}
        errorContent={<ErrorState title="Could not load stock counts" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No stock counts yet" description="Count a warehouse, a rack or a few items to prove what is really there."
          action={canCreate ? { label: "New stock count", onPress: () => router.push(`${STOCK_COUNTS_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="No counts match" description="Try a different view, warehouse or search." />}
        {...paged.grid}
        columnVisibility={columns.visibility}
        onColumnVisibilityChange={columns.setVisibility}
        onRowClick={(row) => router.push(`${STOCK_COUNTS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.warehouse} · {row.countTypeLabel}</span>
            {row.lineCount ? <span className="text-xs text-text-secondary">{row.countedLines} of {row.lineCount} counted</span> : null}
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

"use client";

// Stock Adjustments: corrections of recorded stock to what physically exists — a count found less or more than the books, a data or
// migration error. Not for receipts, deliveries, returns, transfers, consumption or quality moves: each has its own document.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Settings2 } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { money } from "@/features/items/item-format";
import { formatDate } from "@/shared/format/human";
import { ColumnsMenu, filterBarOf, optionLabel, useColumnVisibility, useDebouncedValue, usePagedRows, type OptionalColumn } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { ADJUSTMENTS_BASE, STATUS_LABEL, STATUS_TONE, errorCode, errorMessage, getAdjustmentOptions, listAdjustments, type AdjustmentHeader } from "../api/adjustments-api";

const ANY = "any";
const VIEWS = [{ id: ANY, label: "All" }, { id: "draft", label: "Draft" }, { id: "posted", label: "Posted" }, { id: "reversed", label: "Reversed" }, { id: "cancelled", label: "Cancelled" }];
const OPTIONAL: OptionalColumn[] = [
  { id: "reason", label: "Reason" }, { id: "lineCount", label: "Items" }, { id: "increaseLines", label: "Up" }, { id: "decreaseLines", label: "Down" },
  { id: "valueNet", label: "Value impact" }, { id: "reference", label: "Reference" }, { id: "postedByName", label: "Posted by" },
];
const sortValue = (row: AdjustmentHeader, id: string) => (id === "reference" ? row.countReference ?? row.reference : (row as Record<string, unknown>)[id]);

export function AdjustmentsScreen({ initialItemId }: { initialItemId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [status, setStatus] = useState(ANY);
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const [reasonId, setReasonId] = useState(ANY);
  const [direction, setDirection] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [itemId, setItemId] = useState(initialItemId ?? "");
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = { status: pick(status), search: submitted || undefined, warehouseId: pick(warehouseId), reasonId: pick(reasonId), direction: pick(direction),
    from: from || undefined, to: to || undefined, itemId: itemId || undefined };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "options"), queryFn: getAdjustmentOptions, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "list", filters), queryFn: () => listAdjustments(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "adjustmentDate", desc: true }], sortValue });
  const columns = useColumnVisibility("inventory.adjustments.columns", OPTIONAL);
  const showValue = Boolean(list.data?.seesCost);

  const gridColumns = useMemo(() => ([
    { id: "number", accessorKey: "number", header: "Adjustment", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "adjustmentDate", accessorKey: "adjustmentDate", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.adjustmentDate)}</span> },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "reason", accessorKey: "reason", header: "Reason", cell: ({ row }) => row.original.reason },
    { id: "lineCount", accessorKey: "lineCount", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount}</span> },
    { id: "increaseLines", accessorKey: "increaseLines", header: "Up", cell: ({ row }) => <span className="tabular-nums">{row.original.increaseLines || "—"}</span> },
    { id: "decreaseLines", accessorKey: "decreaseLines", header: "Down", cell: ({ row }) => <span className="tabular-nums">{row.original.decreaseLines || "—"}</span> },
    { id: "valueNet", accessorKey: "valueNet", header: "Value impact",
      cell: ({ row }) => <span className="tabular-nums">{row.original.valueNet === undefined ? "—" : money(row.original.valueNet)}</span> },
    { id: "reference", accessorFn: (row) => row.countReference ?? row.reference, header: "Reference", cell: ({ row }) => row.original.countReference ?? row.original.reference ?? "" },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</StatusBadge> },
    { id: "postedByName", accessorKey: "postedByName", header: "Posted by", cell: ({ row }) => row.original.postedByName ?? "" },
  ] satisfies ColumnDef<AdjustmentHeader, unknown>[]).filter((column) => showValue || column.id !== "valueNet"), [showValue]);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to stock adjustments" description="Ask an administrator for the View stock adjustments permission." />;
  const o = options.data;
  const filterBar = filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
    { id: "reason", active: reasonId !== ANY, label: `Reason: ${optionLabel(o?.reasons, reasonId)}`, clear: () => setReasonId(ANY) },
    { id: "direction", active: direction !== ANY, label: direction === "increase" ? "With increases" : "With decreases", clear: () => setDirection(ANY) },
    { id: "from", active: Boolean(from), label: `On or after ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `On or before ${formatDate(to)}`, clear: () => setTo("") },
    { id: "item", active: Boolean(itemId), label: "One item", clear: () => setItemId("") },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || status !== ANY;
  const canCreate = list.data?.canCreate;

  return (
    <EnterpriseListPage
      header={{
        title: "Stock Adjustments",
        description: "Corrections of recorded stock to what physically exists: a count found less or more, a data or migration error. Goods received, delivered, returned, moved or consumed go through their own documents.",
        primaryAction: canCreate ? <LinkButton href={`${ADJUSTMENTS_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New adjustment</LinkButton> : undefined,
        secondaryActions: o?.capabilities.manageReasons ? <LinkButton href="/inventory/settings?section=reasons&reason=adjustment" variant="outline"><Settings2 className="size-4" aria-hidden="true" />Reasons</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: status, onSelect: (id) => { setStatus(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search adjustments" placeholder="Number, reference, SKU, batch or serial" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
              options={[{ value: ANY, label: "Any warehouse" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
            <Select aria-label="Reason" size="compact" selectedKey={reasonId} onSelectionChange={(key) => setReasonId(String(key))}
              options={[{ value: ANY, label: "Any reason" }, ...(o?.reasons ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
            <Select aria-label="Direction" size="compact" selectedKey={direction} onSelectionChange={(key) => setDirection(String(key))}
              options={[{ value: ANY, label: "Increases and decreases" }, { value: "increase", label: "With increases" }, { value: "decrease", label: "With decreases" }]} />
            <TextField aria-label="From date" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="To date" type="date" value={to} onChange={setTo} />
          </>
        ),
        end: <ColumnsMenu columns={OPTIONAL.filter((column) => showValue || column.id !== "valueNet")} visibility={columns.visibility} onChange={columns.setVisibility} />,
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<AdjustmentHeader>
        aria-label="Stock adjustments"
        columns={gridColumns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading stock adjustments" rows={8} />}
        errorContent={<ErrorState title="Could not load stock adjustments" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No stock adjustments yet" description="Correct the books when a count finds more or less than recorded."
          action={canCreate ? { label: "New adjustment", onPress: () => router.push(`${ADJUSTMENTS_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="No adjustments match" description="Try a different view, search or filter." />}
        {...paged.grid}
        columnVisibility={columns.visibility}
        onColumnVisibilityChange={columns.setVisibility}
        onRowClick={(row) => router.push(`${ADJUSTMENTS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</StatusBadge></span>
            <span className="text-xs text-text-muted">{formatDate(row.adjustmentDate)} · {row.warehouse} · {row.reason}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

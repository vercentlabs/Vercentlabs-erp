"use client";

// Internal Transfers: stock moved inside the company — between warehouses (directly, or dispatched into Goods in Transit and received later) or
// between locations of one warehouse. Not for sales (Sales Delivery), supplier returns (Purchase Return), consumption (Goods Issue) or quality
// releases, which change disposition.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Plus } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
  buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { formatDate } from "@/shared/format/human";
import { ColumnsMenu, useColumnVisibility, useDebouncedValue, usePagedRows, type OptionalColumn } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_LABEL, STATUS_TONE, TRANSFERS_BASE, errorCode, errorMessage, exportUrl, getTransferOptions, listTransfers, type TransferHeader } from "../api/transfers-api";

const ANY = "any";
const VIEWS = [
  { id: ANY, label: "All" }, { id: "draft", label: "Draft" }, { id: "confirmed", label: "Confirmed" }, { id: "in_transit", label: "In transit" },
  { id: "partially_received", label: "Partly received" }, { id: "completed", label: "Completed" }, { id: "cancelled", label: "Cancelled" },
];
const OPTIONAL: OptionalColumn[] = [
  { id: "type", label: "Type" }, { id: "lineCount", label: "Items" }, { id: "inTransit", label: "In transit" }, { id: "expectedArrivalDate", label: "Expected arrival" },
  { id: "reference", label: "Reference", hiddenByDefault: true }, { id: "createdByName", label: "Created by" },
];
const typeLabel = (row: TransferHeader) => (row.type === "location" ? "Between locations" : row.mode === "direct" ? "Warehouse · direct" : "Warehouse · in transit");
const sortValue = (row: TransferHeader, id: string) => (id === "type" ? typeLabel(row) : (row as Record<string, unknown>)[id]);

export function TransfersScreen({ initialItemId }: { initialItemId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState(ANY);
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [type, setType] = useState(ANY);
  const [mode, setMode] = useState(ANY);
  const [sourceWarehouseId, setSource] = useState(ANY);
  const [destinationWarehouseId, setDestination] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [itemId, setItemId] = useState(initialItemId ?? "");
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = { view: pick(view), search: submitted || undefined, type: pick(type), mode: pick(mode), sourceWarehouseId: pick(sourceWarehouseId),
    destinationWarehouseId: pick(destinationWarehouseId), from: from || undefined, to: to || undefined, itemId: itemId || undefined };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "transfers", "options"), queryFn: getTransferOptions, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "transfers", "list", filters), queryFn: () => listTransfers(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "transferDate", desc: true }], sortValue });
  const columns = useColumnVisibility("inventory.transfers.columns", OPTIONAL);

  const gridColumns = useMemo<ColumnDef<TransferHeader, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Transfer", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "transferDate", accessorKey: "transferDate", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.transferDate)}</span> },
    { id: "type", accessorFn: typeLabel, header: "Type", cell: ({ row }) => <span className="whitespace-nowrap">{typeLabel(row.original)}</span> },
    { id: "source", accessorKey: "source", header: "From", cell: ({ row }) => row.original.source },
    { id: "destination", accessorKey: "destination", header: "To", cell: ({ row }) => row.original.destination },
    { id: "lineCount", accessorKey: "lineCount", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount}</span> },
    { id: "inTransit", accessorKey: "inTransit", header: "In transit", cell: ({ row }) => <span className="tabular-nums">{row.original.inTransit ? quantity(row.original.inTransit) : "—"}</span> },
    { id: "expectedArrivalDate", accessorKey: "expectedArrivalDate", header: "Expected arrival", cell: ({ row }) => (row.original.expectedArrivalDate ? formatDate(row.original.expectedArrivalDate) : "—") },
    { id: "reference", accessorKey: "reference", header: "Reference", cell: ({ row }) => row.original.reference ?? "" },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</StatusBadge> },
    { id: "createdByName", accessorKey: "createdByName", header: "Created by", cell: ({ row }) => row.original.createdByName ?? "" },
  ], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to transfers" description="Ask an administrator for the View transfers permission." />;
  const warehouseName = (id: string) => options.data?.warehouses.find((entry) => entry.id === id)?.code ?? id;
  const active: ActiveFilter[] = [
    ...(type !== ANY ? [{ id: "type", label: `Type: ${type === "warehouse" ? "Between warehouses" : "Between locations"}` }] : []),
    ...(mode !== ANY ? [{ id: "mode", label: `Mode: ${mode === "direct" ? "Direct" : "In transit"}` }] : []),
    ...(sourceWarehouseId !== ANY ? [{ id: "source", label: `From: ${warehouseName(sourceWarehouseId)}` }] : []),
    ...(destinationWarehouseId !== ANY ? [{ id: "destination", label: `To: ${warehouseName(destinationWarehouseId)}` }] : []),
    ...(from ? [{ id: "from", label: `On or after ${formatDate(from)}` }] : []),
    ...(to ? [{ id: "to", label: `On or before ${formatDate(to)}` }] : []),
    ...(itemId ? [{ id: "item", label: "One item" }] : []),
  ];
  const remove = (id: string) => {
    if (id === "type") setType(ANY);
    else if (id === "mode") setMode(ANY);
    else if (id === "source") setSource(ANY);
    else if (id === "destination") setDestination(ANY);
    else if (id === "from") setFrom("");
    else if (id === "to") setTo("");
    else if (id === "item") setItemId("");
    paged.resetPage();
  };
  const clearAll = () => { setType(ANY); setMode(ANY); setSource(ANY); setDestination(ANY); setFrom(""); setTo(""); setItemId(""); paged.resetPage(); };
  const filtered = Boolean(submitted) || active.length > 0 || view !== ANY;
  const warehouses = [{ value: ANY, label: "Any warehouse" }, ...(options.data?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))];
  const canCreate = list.data?.canCreate;

  return (
    <EnterpriseListPage
      header={{
        title: "Internal Transfers",
        description: "Stock moved between your warehouses or between locations of one warehouse. Confirming reserves the source stock; goods in transit stay yours until received. A transfer never changes stock's disposition and never touches profit or loss.",
        primaryAction: canCreate ? <LinkButton href={`${TRANSFERS_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New transfer</LinkButton> : undefined,
        secondaryActions: list.data?.canExport ? <a className={buttonVariants({ variant: "outline" })} href={exportUrl(filters)} download><Download className="size-4" aria-hidden="true" />Export</a> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search transfers" placeholder="Number, reference, vehicle, SKU or item" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Type" size="compact" selectedKey={type} onSelectionChange={(key) => setType(String(key))}
              options={[{ value: ANY, label: "Any type" }, { value: "warehouse", label: "Between warehouses" }, { value: "location", label: "Between locations" }]} />
            <Select aria-label="Mode" size="compact" selectedKey={mode} onSelectionChange={(key) => setMode(String(key))}
              options={[{ value: ANY, label: "Any mode" }, { value: "direct", label: "Direct" }, { value: "in_transit", label: "In transit" }]} />
            <Select aria-label="From warehouse" size="compact" selectedKey={sourceWarehouseId} onSelectionChange={(key) => setSource(String(key))}
              options={warehouses.map((entry) => (entry.value === ANY ? { ...entry, label: "Any source" } : entry))} />
            <Select aria-label="To warehouse" size="compact" selectedKey={destinationWarehouseId} onSelectionChange={(key) => setDestination(String(key))}
              options={warehouses.map((entry) => (entry.value === ANY ? { ...entry, label: "Any destination" } : entry))} />
            <TextField aria-label="From date" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="To date" type="date" value={to} onChange={setTo} />
          </>
        ),
        end: <ColumnsMenu columns={OPTIONAL} visibility={columns.visibility} onChange={columns.setVisibility} />,
      }}
      filterBar={active.length ? { filters: active, onRemove: remove, onClearAll: clearAll } : undefined}
    >
      <EnterpriseDataGrid<TransferHeader>
        aria-label="Internal transfers"
        columns={gridColumns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading transfers" rows={8} />}
        errorContent={<ErrorState title="Could not load transfers" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No transfers yet" description="Move stock between warehouses, or between racks and bins of one warehouse."
          action={canCreate ? { label: "New transfer", onPress: () => router.push(`${TRANSFERS_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="No transfers match" description="Try a different view, search or filter." />}
        {...paged.grid}
        columnVisibility={columns.visibility}
        onColumnVisibilityChange={columns.setVisibility}
        onRowClick={(row) => router.push(`${TRANSFERS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</StatusBadge></span>
            <span className="text-xs text-text-muted">{formatDate(row.transferDate)} · {row.source} → {row.destination}</span>
            <span className="text-xs text-text-secondary">{typeLabel(row)} · {row.lineCount} item{row.lineCount === 1 ? "" : "s"}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

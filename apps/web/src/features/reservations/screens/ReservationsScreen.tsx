"use client";

// Stock Reservations: every reservation behind Reserved Stock — one per source document line — with what it asked for, reserved, consumed,
// released and still holds, and where (warehouse, batch, serial). Exceptions lists what needs attention; Reconcile checks Reserved against the
// reservations and their sources, Rebuild restores it from them. Reservations come from their documents, never typed in here.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { ErrorBanner, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { ColumnsMenu, filterBarOf, useColumnVisibility, useDebouncedValue, usePagedRows, type OptionalColumn } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  EXCEPTION_LABEL, STATUS_TONE, errorCode, errorMessage, getReservationExceptions, listReservations, rebuildReservedStock, reconcileReservations, type ReconcileReport,
  type Reservation, type ReservationException,
} from "../api/reservations-api";

export const RESERVATIONS_BASE = "/inventory/reservations";
const ANY = "any";
const VIEWS = [{ id: "active", label: "Active" }, { id: "all", label: "All" }, { id: "consumed", label: "Consumed" }, { id: "released", label: "Released" },
  { id: "cancelled", label: "Cancelled" }, { id: "exceptions", label: "Exceptions" }];
const SOURCES: Record<string, string> = { sales_order: "Sales orders", inventory_transfer: "Transfers", purchase_return: "Purchase returns", manufacturing_work_order: "Work orders" };
const OPTIONAL: OptionalColumn[] = [
  { id: "warehouses", label: "Warehouse" }, { id: "requested", label: "Requested" }, { id: "reserved", label: "Reserved" }, { id: "consumed", label: "Consumed" },
  { id: "released", label: "Released" }, { id: "allocation", label: "Batch / Serial" }, { id: "createdAt", label: "Created" }, { id: "expiresAt", label: "Expires" },
];
const sortValue = (row: Reservation, id: string) => (id === "warehouses" ? row.warehouses.join(", ") : id === "sku" ? row.sku : (row as Record<string, unknown>)[id]);

export function ReservationsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") === "exceptions" ? "exceptions" : params.get("status") ?? "active");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [sourceType, setSourceType] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reconcile, setReconcile] = useState(false);
  const itemId = params.get("itemId") ?? undefined;
  const warehouseId = params.get("warehouseId") ?? undefined;
  const filters = { status: view, search: submitted || undefined, sourceType: sourceType === ANY ? undefined : sourceType, itemId, warehouseId, from: from || undefined, to: to || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "reservations", "list", filters), queryFn: () => listReservations(filters), enabled: view !== "exceptions", placeholderData: (previous) => previous });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "reservations", "exceptions"), queryFn: getReservationExceptions, enabled: view === "exceptions" });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "createdAt", desc: true }], sortValue });
  const columns = useColumnVisibility("inventory.reservations.columns", OPTIONAL);
  const can = list.data?.capabilities;
  const allocations = Boolean(can?.viewAllocations);

  const gridColumns = useMemo(() => ([
    { id: "sku", accessorKey: "sku", header: "Item", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.sku}</span><span className="text-xs text-text-muted">{row.original.itemName}</span></span>
    ) },
    { id: "sourceLabel", accessorKey: "sourceLabel", header: "Source", cell: ({ row }) => row.original.sourceLabel },
    { id: "document", accessorKey: "document", header: "Document", cell: ({ row }) => (
      <span className="whitespace-nowrap">{row.original.sourceHref
        ? <Link className="text-brand hover:underline" href={row.original.sourceHref} onClick={(event) => event.stopPropagation()}>{row.original.document ?? "Open"}</Link>
        : row.original.document ?? "—"}{row.original.sourceLineNumber ? <span className="text-text-muted"> · line {row.original.sourceLineNumber}</span> : null}</span>
    ) },
    { id: "warehouses", accessorFn: (row) => row.warehouses.join(", "), header: "Warehouse", cell: ({ row }) => row.original.warehouses.join(", ") },
    { id: "requested", accessorKey: "requested", header: "Requested", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.requested, row.original.baseUom)}</span> },
    { id: "reserved", accessorKey: "reserved", header: "Reserved", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.reserved)}</span> },
    { id: "consumed", accessorKey: "consumed", header: "Consumed", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.consumed)}</span> },
    { id: "released", accessorKey: "released", header: "Released", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.released)}</span> },
    { id: "active", accessorKey: "active", header: "Holding", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col tabular-nums"><span className="font-medium">{quantity(row.original.active)}</span>
        {row.original.status === "active" && row.original.unreserved > 0 ? <span className="text-xs text-warning">{quantity(row.original.unreserved)} unreserved</span> : null}</span>
    ) },
    { id: "allocation", header: "Batch / Serial", enableSorting: false, cell: ({ row }) => [...(row.original.batches ?? []), ...(row.original.serials ?? [])].join(", ") },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span> },
    { id: "expiresAt", accessorKey: "expiresAt", header: "Expires", cell: ({ row }) => (row.original.expiresAt ? formatDateTime(row.original.expiresAt) : "") },
  ] satisfies ColumnDef<Reservation, unknown>[]).filter((column) => allocations || column.id !== "allocation"), [allocations]);
  const exceptionColumns = useMemo<ColumnDef<ReservationException, unknown>[]>(() => [
    { id: "kind", header: "Problem", cell: ({ row }) => <StatusBadge tone="danger">{EXCEPTION_LABEL[row.original.kind] ?? row.original.kind}</StatusBadge> },
    { id: "source", header: "Source", cell: ({ row }) => `${row.original.reservation.sourceLabel} ${row.original.reservation.document ?? ""}` },
    { id: "item", header: "Item", cell: ({ row }) => `${row.original.reservation.sku} · ${row.original.reservation.itemName}` },
    { id: "allocation", header: "Allocation", cell: ({ row }) => `${row.original.reservation.number} · ${row.original.reservation.warehouse} · ${row.original.reservation.allocation}` },
    { id: "active", header: "Reserved", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.reservation.active, row.original.reservation.baseUom)}</span> },
    { id: "message", header: "What to do", cell: ({ row }) => <span className="text-danger">{row.original.message}</span> },
  ], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to stock reservations" description="Ask an administrator for the View stock reservations permission." />;
  const open = (id: string) => router.push(`${RESERVATIONS_BASE}/${id}`);
  const filterBar = view === "exceptions" ? undefined : filterBarOf([
    { id: "source", active: sourceType !== ANY, label: `Source: ${SOURCES[sourceType] ?? sourceType}`, clear: () => setSourceType(ANY) },
    { id: "from", active: Boolean(from), label: `On or after ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `On or before ${formatDate(to)}`, clear: () => setTo("") },
    { id: "scope", active: Boolean(itemId || warehouseId), label: itemId ? "One item" : "One warehouse", clear: () => router.replace(RESERVATIONS_BASE) },
  ], paged.resetPage);
  const exceptionRows = exceptions.data?.exceptions ?? [];

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Stock Reservations",
          description: "Stock held for sales orders, transfers, purchase returns and work orders. Reserved stock stays on hand but is not available; its document consumes it. Nothing here moves stock or posts to the books.",
          secondaryActions: can?.reconcile ? <Button variant="outline" onPress={() => setReconcile(true)}>Reconcile</Button> : undefined,
        }}
        savedViews={{ views: VIEWS.filter((entry) => entry.id !== "exceptions" || can?.exceptions !== false), activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
        actionBar={view === "exceptions" ? undefined : {
          start: (
            <>
              <SearchField aria-label="Search reservations" placeholder="SKU, item, document, batch, serial or RSV number" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Source" size="compact" selectedKey={sourceType} onSelectionChange={(key) => setSourceType(String(key))}
                options={[{ value: ANY, label: "Any source" }, ...Object.entries(SOURCES).map(([value, label]) => ({ value, label }))]} />
              <TextField aria-label="From date" type="date" value={from} onChange={setFrom} />
              <TextField aria-label="To date" type="date" value={to} onChange={setTo} />
            </>
          ),
          end: <ColumnsMenu columns={OPTIONAL.filter((column) => allocations || column.id !== "allocation")} visibility={columns.visibility} onChange={columns.setVisibility} />,
        }}
        filterBar={filterBar}
      >
        {view === "exceptions" ? (
          <>
            {(exceptions.data?.projectionMismatches.length ?? 0) > 0 && <Notice>
              {exceptions.data!.projectionMismatches.length} stock position{exceptions.data!.projectionMismatches.length === 1 ? "" : "s"} show a Reserved figure that differs from their reservations. Reconcile, then rebuild.</Notice>}
            <EnterpriseDataGrid<ReservationException>
              aria-label="Reservation exceptions"
              columns={exceptionColumns}
              data={exceptionRows}
              getRowId={(row) => `${row.reservation.id}-${row.kind}`}
              state={exceptions.isLoading ? "loading" : exceptions.isError ? "error" : exceptionRows.length === 0 ? "empty" : "ready"}
              loadingContent={<LoadingState label="Checking reservations" rows={4} />}
              errorContent={<ErrorState title="Could not check reservations" description={errorMessage(exceptions.error)} action={{ label: "Try again", onPress: () => void exceptions.refetch() }} />}
              emptyContent={<EmptyState title="Nothing needs attention" description="Every active reservation is on eligible stock, for an open document, and Reserved matches the reservations." />}
              onRowClick={(row) => row.reservation.reservationId && open(row.reservation.reservationId)}
            />
          </>
        ) : (
          <>
            {list.data && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard label="Reservations" value={list.data.total} />
                <MetricCard label="Active reserved (base units)" value={quantity(list.data.totalActive)} />
              </div>
            )}
            <EnterpriseDataGrid<Reservation>
              aria-label="Stock reservations"
              columns={gridColumns}
              data={paged.pageRows}
              getRowId={(row) => row.id}
              state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filterBar || submitted || view !== "active" ? "no-results" : "empty") : "ready"}
              loadingContent={<LoadingState label="Loading reservations" rows={8} />}
              errorContent={<ErrorState title="Could not load reservations" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
              emptyContent={<EmptyState title="No reservations" description="Confirmed sales orders and transfers reserve stock here." />}
              noResultsContent={<NoResultsState title="No reservations match" description="Try a different view, search or filter." />}
              {...paged.grid}
              columnVisibility={columns.visibility}
              onColumnVisibilityChange={columns.setVisibility}
              onRowClick={(row) => open(row.id)}
              renderMobileCard={(row) => (
                <div className="flex flex-col gap-1">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.sku}</span><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
                  <span className="text-xs text-text-muted">{row.sourceLabel} {row.document ?? ""} · {row.warehouses.join(", ")}</span>
                  <span className="text-xs text-text-secondary">Holding {quantity(row.active, row.baseUom)}</span>
                </div>
              )}
            />
          </>
        )}
      </EnterpriseListPage>
      {reconcile && <ReconcileDialog canRebuild={Boolean(can?.rebuild)} onClose={() => setReconcile(false)} />}
    </>
  );
}

function ReconcileDialog({ canRebuild, onClose }: { canRebuild: boolean; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "reservations", "reconcile"), queryFn: reconcileReservations });
  const [reason, setReason] = useState("");
  const rebuild = useMutation({ mutationFn: () => rebuildReservedStock(reason.trim()), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "reservations") }); } });
  const data: ReconcileReport | undefined = report.data;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Reconcile reservations" description="Reserved Stock is a projection of the active reservations; this checks it and the reservations' sources. Nothing is changed.">
      <div className="flex flex-col gap-3 text-sm">
        {report.isLoading ? <LoadingState label="Reconciling" rows={3} /> : data ? <>
          <p className={data.consistent ? "text-success" : "text-danger"}>{data.consistent ? "Everything reconciles." : "Differences found:"}</p>
          {data.projection.length > 0 && <p>{data.projection.length} stock position{data.projection.length === 1 ? "" : "s"} where Reserved differs from the reservations (e.g. {data.projection[0].projection} recorded, {data.projection[0].reservations} reserved).</p>}
          {data.reservationTotals.length > 0 && <p>{data.reservationTotals.length} reservation{data.reservationTotals.length === 1 ? "" : "s"} whose totals differ from their allocations.</p>}
          {data.unattachedAllocations > 0 && <p>{data.unattachedAllocations} allocation{data.unattachedAllocations === 1 ? "" : "s"} without a reservation.</p>}
          {data.serialsHeldTwice.length > 0 && <p>{data.serialsHeldTwice.length} serial number{data.serialsHeldTwice.length === 1 ? "" : "s"} held twice.</p>}
          {data.sourceIssues.length > 0 && <ul className="list-disc pl-5">{data.sourceIssues.slice(0, 10).map((entry, index) => <li key={index}>{entry.allocation}: {entry.message}</li>)}</ul>}
          {canRebuild && data.projection.length > 0 && <>
            <TextArea label="Reason for rebuilding Reserved" value={reason} onChange={setReason} description="Rebuilding sets Reserved from the active reservations; no reservation is changed." />
            {rebuild.data && <p className="text-success">Rebuilt: {rebuild.data.corrected} position{rebuild.data.corrected === 1 ? "" : "s"} corrected.</p>}
          </>}
        </> : <ErrorBanner message={errorMessage(report.error)} />}
        <ErrorBanner message={rebuild.isError ? errorMessage(rebuild.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          {canRebuild && (data?.projection.length ?? 0) > 0 && <Button variant="primary" isDisabled={reason.trim().length < 3} isLoading={rebuild.isPending} onPress={() => rebuild.mutate()}>Rebuild Reserved</Button>}</div>
      </div>
    </Dialog>
  );
}

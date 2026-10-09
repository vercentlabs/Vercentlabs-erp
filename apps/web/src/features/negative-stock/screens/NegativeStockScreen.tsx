"use client";

// Negative Stock: every stock position that an authorised override took below zero — open until a real receipt, return or transfer brings it
// back, then resolved (kept for good). Shows the on hand as it is (never clamped), since when, what caused it, the override reason and who gave
// it; the audit of every override, blocked attempt and policy change; and reconciliation of the exceptions against the balances. Nothing here
// edits stock. Views: Open, Resolved, All, Audit and Reconciliation.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  checkNegativeReconciliation, errorCode, errorMessage, getNegativeSettings, listNegativeAudit, listNegativeStock, negativeExportUrl, repairNegativeReconciliation,
  type NegativeRow, type ReconcileReport,
} from "../api/negative-stock-api";

const ANY = "any";
const POSITION_VIEWS = ["open", "resolved", "all"];
const qty = (value: number | null | undefined, uom?: string | null) => (value === null || value === undefined ? "—" : `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 })}${uom ? ` ${uom}` : ""}`);
type AuditRow = Awaited<ReturnType<typeof listNegativeAudit>>["rows"][number];

export function NegativeStockScreen() {
  const workspace = useWorkspaceContext();
  const params = useSearchParams();
  const [itemId, setItemId] = useState<string | undefined>(params.get("itemId") ?? undefined);
  const [view, setView] = useState(params.get("status") ?? "open");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const [reasonCode, setReasonCode] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [eventType, setEventType] = useState(ANY);
  const isPositions = POSITION_VIEWS.includes(view);
  const pick = (value: string) => (value === ANY || !value ? undefined : value);
  const filters = { status: isPositions ? view : "open", itemId, search: submitted || undefined, warehouseId: pick(warehouseId), reasonCode: pick(reasonCode), from: pick(from), to: pick(to) };
  const options = useInvOptions();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "negative-stock", "settings"), queryFn: getNegativeSettings, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "negative-stock", "list", filters), queryFn: () => listNegativeStock(filters), enabled: isPositions, placeholderData: (previous) => previous });
  const auditFilters = { eventType: eventType === ANY ? undefined : eventType };
  const audit = useQuery({ queryKey: scopedQueryKey(workspace, "negative-stock", "audit", auditFilters), queryFn: () => listNegativeAudit(auditFilters), enabled: view === "audit",
    placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const auditRows = useMemo(() => audit.data?.rows ?? [], [audit.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "negativeSince", desc: true }] });
  const pagedAudit = usePagedRows(auditRows, { initialSorting: [{ id: "at", desc: true }] });

  const positionColumns = useMemo<ColumnDef<NegativeRow, unknown>[]>(() => [
    { id: "sku", accessorKey: "sku", header: "SKU", cell: ({ row }) => <Link className="font-medium text-brand hover:underline" href={row.original.itemStockHref}>{row.original.sku}</Link> },
    { id: "itemName", accessorKey: "itemName", header: "Item", cell: ({ row }) => <span className="flex flex-col">{row.original.itemName}{row.original.category ? <span className="text-xs text-text-muted">{row.original.category}</span> : null}</span> },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "location", accessorKey: "location", header: "Location", cell: ({ row }) => <span className="flex flex-col">{row.original.location}{row.original.batch ? <span className="text-xs text-text-muted">Batch {row.original.batch}</span> : null}</span> },
    { id: "onHand", accessorKey: "onHand", header: "On hand", cell: ({ row }) => (
      <span className={`flex flex-col font-semibold tabular-nums ${row.original.status === "open" ? "text-danger" : ""}`}>{qty(row.original.onHand, row.original.baseUom)}
        {row.original.status === "open" && row.original.lowest < row.original.onHand ? <span className="text-xs font-normal text-text-muted">lowest {qty(row.original.lowest)}</span> : null}</span>
    ) },
    { id: "negativeSince", accessorKey: "negativeSince", header: "Negative since", cell: ({ row }) => (
      <span className="flex flex-col whitespace-nowrap">{formatDateTime(row.original.negativeSince)}<span className="text-xs text-text-muted">{row.original.ageDays} day{row.original.ageDays === 1 ? "" : "s"}</span></span>
    ) },
    { id: "lastMovement", accessorKey: "lastMovement", header: "Last movement", cell: ({ row }) => <Link className="text-brand hover:underline" href={row.original.ledgerHref}>{row.original.lastMovement ?? row.original.cause ?? "Ledger"}</Link> },
    { id: "source", header: "Source", enableSorting: false, cell: ({ row }) => (row.original.source
      ? (row.original.source.href ? <Link className="text-brand hover:underline" href={row.original.source.href}>{row.original.source.number}</Link> : row.original.source.number) : row.original.cause ?? "") },
    { id: "reason", accessorKey: "reason", header: "Override reason", cell: ({ row }) => <span className="flex flex-col">{row.original.reason ?? "—"}{row.original.notes ? <span className="max-w-xs text-xs text-text-muted">{row.original.notes}</span> : null}</span> },
    { id: "overriddenBy", accessorKey: "overriddenBy", header: "Override user", cell: ({ row }) => row.original.overriddenBy ?? "" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-col gap-0.5">
        {row.original.status === "open" ? <StatusBadge tone="danger">{row.original.origin === "reconciliation" ? "Open · no override" : "Open"}</StatusBadge> : <StatusBadge tone="success">Resolved</StatusBadge>}
        {row.original.resolvedBy && <span className="text-xs text-text-muted">by {row.original.resolvedBy.href
          ? <Link className="text-brand hover:underline" href={row.original.resolvedBy.href}>{row.original.resolvedBy.number}</Link> : row.original.resolvedBy.number}
          {row.original.resolvedAt ? ` · ${formatDateTime(row.original.resolvedAt)}` : ""}</span>}
      </span>
    ) },
  ], []);
  const auditColumns = useMemo<ColumnDef<AuditRow, unknown>[]>(() => [
    { id: "at", accessorKey: "at", header: "When", cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.at)}</span> },
    { id: "label", accessorKey: "label", header: "Event", cell: ({ row }) => (
      <span className="flex flex-col">{row.original.label}{typeof row.original.details.code === "string" ? <span className="text-xs text-text-muted">{row.original.details.code}</span> : null}
        {row.original.type === "policy_changed" ? <span className="text-xs text-text-muted">{policyChange(row.original.details)}</span> : null}</span>
    ) },
    { id: "sku", accessorKey: "sku", header: "Item", cell: ({ row }) => (row.original.sku ? `${row.original.sku} · ${row.original.itemName}` : "") },
    { id: "where", header: "Where", enableSorting: false, cell: ({ row }) => (
      <span className="flex flex-col">{row.original.warehouse ? `${row.original.warehouse} / ${row.original.location}` : "—"}{row.original.movement ? <span className="text-xs text-text-muted">{row.original.movement}</span> : null}</span>
    ) },
    { id: "before", accessorKey: "before", header: "Before", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.before)}</span> },
    { id: "quantity", accessorKey: "quantity", header: "Movement", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantity)}</span> },
    { id: "after", accessorKey: "after", header: "After", cell: ({ row }) => <span className={`tabular-nums ${(row.original.after ?? 0) < 0 ? "text-danger" : ""}`}>{qty(row.original.after)}</span> },
    { id: "reason", accessorKey: "reason", header: "Reason", cell: ({ row }) => <span className="flex flex-col">{row.original.reason ?? "—"}{row.original.notes ? <span className="max-w-xs text-xs text-text-muted">{row.original.notes}</span> : null}</span> },
    { id: "by", accessorKey: "by", header: "By", cell: ({ row }) => row.original.by ?? "" },
  ], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to negative stock" description="Ask an administrator for the View negative-stock exceptions permission." />;
  const can = list.data?.capabilities ?? settings.data?.capabilities;
  const policy = settings.data?.policy;
  const views = [{ id: "open", label: "Open" }, { id: "resolved", label: "Resolved" }, { id: "all", label: "All" },
    ...(can?.viewAudit ? [{ id: "audit", label: "Audit" }] : []), { id: "reconcile", label: "Reconciliation" }];
  const filterBar = isPositions ? filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(options.data?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
    { id: "reason", active: reasonCode !== ANY, label: `Reason: ${optionLabel(list.data?.reasons, reasonCode)}`, clear: () => setReasonCode(ANY) },
    { id: "from", active: Boolean(from), label: `Negative on or after ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `Negative on or before ${formatDate(to)}`, clear: () => setTo("") },
    { id: "item", active: Boolean(itemId), label: "One item", clear: () => setItemId(undefined) },
  ], paged.resetPage) : view === "audit" ? filterBarOf([
    { id: "event", active: eventType !== ANY, label: `Event: ${optionLabel(audit.data?.eventTypes, eventType)}`, clear: () => setEventType(ANY) },
  ], pagedAudit.resetPage) : undefined;
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "open";

  return (
    <EnterpriseListPage
      header={{
        title: "Negative Stock",
        description: "Stock positions an authorised override took below zero. A position stays open until a real receipt, return, transfer or positive adjustment brings it back; it is never edited directly.",
        secondaryActions: can?.export && isPositions ? (
          <>
            <a className={buttonVariants({ variant: "outline" })} href={negativeExportUrl(filters, "csv")} download><Download className="size-4" aria-hidden="true" />CSV</a>
            <a className={buttonVariants({ variant: "outline" })} href={negativeExportUrl(filters, "xlsx")} download><Download className="size-4" aria-hidden="true" />Excel</a>
          </>
        ) : undefined,
      }}
      savedViews={{ views, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={isPositions ? {
        start: (
          <>
            <SearchField aria-label="Search" placeholder="SKU, item or source document" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
              options={[{ value: ANY, label: "Any warehouse" }, ...(options.data?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
            <Select aria-label="Override reason" size="compact" selectedKey={reasonCode} onSelectionChange={(key) => setReasonCode(String(key))}
              options={[{ value: ANY, label: "Any reason" }, ...(list.data?.reasons ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
            <TextField aria-label="Negative from" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="Negative to" type="date" value={to} onChange={setTo} />
          </>
        ),
      } : view === "audit" ? {
        start: <Select aria-label="Event" size="compact" selectedKey={eventType} onSelectionChange={(key) => setEventType(String(key))}
          options={[{ value: ANY, label: "Every event" }, ...(audit.data?.eventTypes ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />,
      } : undefined}
      filterBar={filterBar}
    >
      {policy && <Notice tone="neutral">Company policy: <span className="font-medium text-text">{policy === "block" ? "Block negative stock" : "Allow with authorised override (untracked items only)"}</span>.
        {" "}<Link className="text-brand hover:underline" href="/inventory/settings?section=policies">Change it in Inventory Policies</Link>.</Notice>}
      {isPositions && (
        <EnterpriseDataGrid<NegativeRow>
          aria-label="Negative stock positions"
          columns={positionColumns}
          data={paged.pageRows}
          getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading negative stock" rows={6} />}
          errorContent={<ErrorState title="Could not load negative stock" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="No negative stock" description="Every stock position is at zero or above." />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, warehouse, reason or date." />}
          {...paged.grid}
        />
      )}
      {view === "audit" && (
        <EnterpriseDataGrid<AuditRow>
          aria-label="Negative stock audit"
          columns={auditColumns}
          data={pagedAudit.pageRows}
          getRowId={(row) => row.id}
          state={audit.isLoading ? "loading" : audit.isError ? "error" : auditRows.length === 0 ? (eventType !== ANY ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading audit" rows={6} />}
          errorContent={<ErrorState title="Could not load the audit" description={errorMessage(audit.error)} action={{ label: "Try again", onPress: () => void audit.refetch() }} />}
          emptyContent={<EmptyState title="Nothing recorded yet" description="Overrides, blocked attempts and policy changes appear here." />}
          {...pagedAudit.grid}
        />
      )}
      {view === "reconcile" && <ReconcilePanel canRepair={Boolean(can?.configure)} />}
    </EnterpriseListPage>
  );
}

const policyChange = (details: Record<string, unknown>) => {
  const label = (value: unknown) => (value && typeof value === "object" && "policy" in value ? ((value as { policy: string }).policy === "block" ? "Block" : "Allow with override") : "?");
  return `${label(details.from)} → ${label(details.to)}`;
};

function ReconcilePanel({ canRepair }: { canRepair: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const check = useMutation({ mutationFn: checkNegativeReconciliation, onSuccess: setReport });
  const repair = useMutation({ mutationFn: repairNegativeReconciliation, onSuccess: (data) => { setReport(data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "negative-stock") }); } });
  return (
    <Panel title="Reconciliation" description="Every open exception should match a stock balance below zero, and every balance below zero should have an open exception. A balance below zero with none is an integrity failure to investigate. Repairing fixes the exception records only — never a balance."
      actions={<>
        <Button variant="secondary" size="compact" isLoading={check.isPending} onPress={() => check.mutate()}>Check now</Button>
        {canRepair && report && !report.consistent && <Button variant="primary" size="compact" isLoading={repair.isPending} onPress={() => repair.mutate()}>Repair exception records</Button>}
      </>}>
      <div className="flex flex-col gap-3 text-sm">
        {(check.isError || repair.isError) && <Notice>{errorMessage(check.error ?? repair.error)}</Notice>}
        {!report && <p className="text-text-muted">Not checked yet.</p>}
        {report && (report.consistent ? <div><StatusBadge tone="success">{`Consistent${report.repaired ? ` · ${report.repaired} repaired` : ""}`}</StatusBadge></div> : (
          <div className="flex flex-col gap-2">
            {report.unrecorded.length > 0 && <div><p className="font-medium text-danger">Negative with no open exception ({report.unrecorded.length})</p>
              <ul className="list-disc pl-5">{report.unrecorded.map((row, index) => <li key={index}>{row.sku} · {row.warehouse}: {qty(row.onHand)}</li>)}</ul></div>}
            {report.stale.length > 0 && <div><p className="font-medium">Open exceptions no longer negative ({report.stale.length})</p>
              <ul className="list-disc pl-5">{report.stale.map((row) => <li key={row.exceptionId}>{row.sku} · {row.warehouse}: {qty(row.onHand)}</li>)}</ul></div>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

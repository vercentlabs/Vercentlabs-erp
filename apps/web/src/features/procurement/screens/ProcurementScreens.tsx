"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { actOn, getDashboard, listRecords, type ProcRecord } from "@/features/procurement/shared/api";
import { dateTime, money, statusLabel, statusTone } from "@/features/procurement/shared/format";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";

// ------------------------------------------------------------------ home
const num = (value: unknown) => String(Number(value ?? 0));

export function ProcurementHomeScreen() {
  const workspace = useWorkspaceContext();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "dashboard"), queryFn: getDashboard });
  if (query.isError && query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to Procurement" description="Ask an administrator to grant procurement.view." />;
  const d = query.data;
  const links = [
    { href: "/procurement/requisitions", label: "Requisitions", hint: "Request and approve purchases" },
    { href: "/procurement/rfqs", label: "RFQs", hint: "Invite suppliers and compare bids" },
    { href: "/procurement/orders", label: "Purchase orders", hint: "Order, approve, dispatch, amend" },
    { href: "/procurement/receipts", label: "Goods receipts", hint: "Receive stock against orders" },
    { href: "/procurement/invoices", label: "Supplier invoices", hint: "Match invoices to orders and receipts" },
    { href: "/procurement/suppliers", label: "Suppliers", hint: "Onboarding, qualification, performance" },
    ...(can("procurement.reports.view") ? [{ href: "/procurement/spend-analytics", label: "Spend analytics", hint: "Where the money goes" }] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Procurement" description="Source-to-pay at a glance. Figures are live and limited to the companies you can access." />
      {query.isError ? (
        <ErrorState title="Could not load the dashboard" action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : (
        <MetricStrip
          metrics={[
            { label: "Requisitions awaiting approval", value: d ? num(d.pending_requisitions) : "…" },
            { label: "Active sourcing events", value: d ? num(d.active_sourcing) : "…" },
            { label: "Open purchase orders", value: d ? num(d.open_purchase_orders) : "…" },
            { label: "Receipts to process", value: d ? num(d.pending_receipts) : "…" },
            { label: "Open match exceptions", value: d ? num(d.match_exceptions) : "…" },
            { label: "Supplier risks", value: d ? num(d.supplier_risks) : "…" },
          ]}
        />
      )}
      <ProcPanel title="Go to">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="flex h-full flex-col gap-0.5 rounded-[var(--radius-control)] border border-border p-3 transition-colors hover:bg-surface-muted">
                <span className="text-sm font-medium text-text">{link.label}</span>
                <span className="text-xs text-text-muted">{link.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </ProcPanel>
    </div>
  );
}

// -------------------------------------------------------- approval queue
type QueueSource = { resource: string; kind: string; statuses: string[]; approve: string; reject?: string; permission: string; href: (id: string) => string; number: (r: ProcRecord) => string };
const SOURCES: QueueSource[] = [
  { resource: "requisitions", kind: "Requisition", statuses: ["submitted", "pending_approval"], approve: "approve", reject: "reject", permission: "procurement.requisition.approve", href: (id) => `/procurement/requisitions/${id}`, number: (r) => String(r.requisitionNumber ?? r.title ?? r.id) },
  { resource: "purchase-orders", kind: "Purchase order", statuses: ["submitted", "pending_approval"], approve: "approve", reject: "reject", permission: "procurement.po.approve", href: (id) => `/procurement/orders/${id}`, number: (r) => String(r.purchaseOrderNumber ?? r.title ?? r.id) },
  { resource: "receipts", kind: "Goods receipt", statuses: ["submitted"], approve: "approve", reject: "reject", permission: "procurement.receipts.approve", href: (id) => `/procurement/receipts/${id}`, number: (r) => String(r.receiptNumber ?? r.id) },
  { resource: "returns", kind: "Purchase return", statuses: ["submitted"], approve: "approve", reject: "reject", permission: "procurement.receipts.approve", href: (id) => `/procurement/returns/${id}`, number: (r) => String(r.returnNumber ?? r.id) },
  { resource: "agreements", kind: "Agreement", statuses: ["submitted"], approve: "approve", permission: "procurement.contracts.approve", href: (id) => `/procurement/agreements/${id}`, number: (r) => String(r.agreementNumber ?? r.title ?? r.id) },
  { resource: "sourcing-events", kind: "RFQ", statuses: ["submitted"], approve: "approve", permission: "procurement.sourcing.evaluate", href: (id) => `/procurement/rfqs/${id}`, number: (r) => String(r.eventNumber ?? r.title ?? r.id) },
  { resource: "suppliers", kind: "Supplier qualification", statuses: ["submitted"], approve: "qualify", permission: "procurement.suppliers.qualify", href: (id) => `/procurement/suppliers/${id}`, number: (r) => String(r.displayName ?? r.supplierCode ?? r.id) },
];

type QueueRow = ProcRecord & { _source: QueueSource };

export function ApprovalQueueScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState("");
  const sources = SOURCES.filter((source) => can(source.permission));

  const results = useQueries({
    queries: sources.flatMap((source) =>
      source.statuses.map((status) => ({
        queryKey: scopedQueryKey(workspace, "procurement", "queue", source.resource, status),
        queryFn: () => listRecords(source.resource, { status, limit: 100 }).then((r) => r.rows.map((row) => ({ ...row, _source: source }) as QueueRow)),
      })),
    ),
  });
  const rows = results.flatMap((result) => result.data ?? []).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  const loading = results.some((result) => result.isLoading);

  const decide = useMutation({
    mutationFn: ({ row, action, why }: { row: QueueRow; action: string; why?: string }) => actOn(row._source.resource, row.id, action, { expectedVersion: row.version, ...(why ? { reason: why } : {}) }),
    onSuccess: (_r, { action }) => {
      setError(null);
      setNotice(action === "reject" ? "Rejected." : "Approved.");
      setRejecting(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
    },
    onError: (err) => setError(err instanceof ProcApiError ? err.message : "This could not be completed."),
  });

  const columns: ColumnDef<QueueRow, unknown>[] = [
    { id: "kind", header: "Type", accessorFn: (r) => r._source.kind },
    { id: "ref", header: "Document", cell: ({ row }) => <Link href={row.original._source.href(row.original.id)} className="font-medium text-brand hover:underline">{row.original._source.number(row.original)}</Link> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "amount", header: "Amount", accessorFn: (r) => (r.totals?.grandTotal ? money(r.currencyCode, r.totals.grandTotal) : "—") },
    { id: "when", header: "Last updated", accessorFn: (r) => dateTime(r.updated_at) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Approval queue" description="Everything waiting for your decision. You only see what your permissions let you approve, and you can never approve something you submitted." />
      {error && <ProcAlert>{error}</ProcAlert>}
      {notice && !error && <ProcAlert tone="success">{notice}</ProcAlert>}
      <EnterpriseDataGrid<QueueRow>
        aria-label="Approval queue"
        columns={columns}
        data={rows}
        getRowId={(row) => `${row._source.resource}:${row.id}`}
        state={loading ? "loading" : rows.length ? "ready" : "empty"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
        emptyContent={<p className="px-4 py-8 text-sm text-text-muted">Nothing is waiting for you.</p>}
        rowActions={(row) => (
          <div className="flex gap-1">
            <Button variant="ghost" size="compact" onPress={() => decide.mutate({ row, action: row._source.approve })} isLoading={decide.isPending && decide.variables?.row.id === row.id}>
              {row._source.approve === "qualify" ? "Qualify" : "Approve"}
            </Button>
            {row._source.reject && (
              <Button variant="ghost" size="compact" onPress={() => { setError(null); setRejecting(row); }}>
                Reject
              </Button>
            )}
          </div>
        )}
      />
      {rejecting && (
        <Dialog isOpen onOpenChange={(open) => !open && setRejecting(null)} title={`Reject ${rejecting._source.kind.toLowerCase()}`}>
          <div className="flex flex-col gap-4">
            {error && <ProcAlert>{error}</ProcAlert>}
            <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setRejecting(null)}>
                Close
              </Button>
              <Button variant="primary" onPress={() => decide.mutate({ row: rejecting, action: "reject", why: reason.trim() })} isLoading={decide.isPending} isDisabled={!reason.trim()}>
                Reject
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

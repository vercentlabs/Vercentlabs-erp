"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataGrid, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listRecords, type ProcRecord } from "@/features/procurement/shared/api";
import { ChildSection } from "@/features/procurement/shared/ChildSection";
import { DocumentDetail } from "@/features/procurement/shared/DocumentDetail";
import { calendarDate, dateTime, statusLabel, statusTone } from "@/features/procurement/shared/format";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { orderDetail } from "@/features/procurement/configs/orders";

// F074-F076/F080-F082: the purchase order with the receipts posted against it,
// advance shipping notices from the supplier, and its amendment history.
export function OrderDetailScreen({ id }: { id: string }) {
  const config = {
    ...orderDetail,
    banner: (record: ProcRecord) =>
      record.status === "pending_amendment_approval" ? (
        <ProcAlert tone="info">An amendment is awaiting approval. The order keeps its previous version until someone other than its author approves it.</ProcAlert>
      ) : null,
    sections: [
      { id: "receipts", label: "Receipts", render: (record: ProcRecord) => <ReceiptsForOrder orderId={record.id} /> },
      {
        id: "shipping",
        label: "Shipping notices",
        render: (record: ProcRecord) => (
          <ChildSection
            parentId={record.id}
            parentStatus={record.status}
            config={{
              resource: "advance-shipping-notices",
              title: "Advance shipping notices",
              description: "What the supplier says is on its way.",
              noun: "notice",
              manage: "procurement.receipts.manage",
              emptyText: "No shipping notices yet.",
              fields: [
                { name: "carrier", label: "Carrier", kind: "text" },
                { name: "trackingNumber", label: "Tracking / AWB", kind: "text" },
                { name: "shippedOn", label: "Shipped on", kind: "date" },
                { name: "expectedArrival", label: "Expected arrival", kind: "date", required: true },
                { name: "notes", label: "Notes", kind: "textarea" },
              ],
              columns: [
                { id: "carrier", header: "Carrier", accessorFn: (r) => String(r.carrier ?? "—") },
                { id: "track", header: "Tracking", accessorFn: (r) => String(r.trackingNumber ?? "—") },
                { id: "ship", header: "Shipped", accessorFn: (r) => calendarDate(r.shippedOn) },
                { id: "eta", header: "Expected", accessorFn: (r) => calendarDate(r.expectedArrival) },
              ],
            }}
          />
        ),
      },
      { id: "amendments", label: "Amendments", render: (record: ProcRecord) => <AmendmentHistory record={record} /> },
    ],
  };
  return <DocumentDetail config={config} id={id} />;
}

function ReceiptsForOrder({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "receipts", "for-order", orderId), queryFn: () => listRecords("receipts", { limit: 200 }).then((r) => r.rows.filter((row) => row.purchaseOrderId === orderId)) });
  const rows = query.data ?? [];
  const columns: ColumnDef<ProcRecord, unknown>[] = [
    { id: "number", header: "Receipt", cell: ({ row }) => <Link href={`/procurement/receipts/${row.original.id}`} className="font-medium text-brand hover:underline">{String(row.original.receiptNumber ?? row.original.id)}</Link> },
    { id: "date", header: "Received", accessorFn: (r) => calendarDate(r.receiptDate) },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
  ];
  return (
    <ProcPanel title="Goods receipts against this order">
      <EnterpriseDataGrid<ProcRecord> aria-label="Receipts for this order" columns={columns} data={rows} getRowId={(row) => row.id} density="compact" state={query.isLoading ? "loading" : rows.length ? "ready" : "empty"} loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">Nothing received yet.</p>} />
    </ProcPanel>
  );
}

function AmendmentHistory({ record }: { record: ProcRecord }) {
  const rows = (Array.isArray(record.amendments) ? record.amendments : []) as Array<Record<string, unknown>>;
  const columns: ColumnDef<Record<string, unknown>, unknown>[] = [
    { id: "when", header: "Requested", accessorFn: (r) => dateTime(r.requestedAt) },
    { id: "reason", header: "Reason", accessorFn: (r) => String(r.reason ?? "—") },
    { id: "status", header: "Outcome", accessorFn: (r) => statusLabel(r.status) },
    { id: "note", header: "Decision note", accessorFn: (r) => String(r.approvalNote ?? r.rejectionReason ?? "—") },
  ];
  return (
    <ProcPanel title="Amendment history" description="Every change to an issued order is recorded, with who asked, why, and how it ended.">
      <EnterpriseDataGrid<Record<string, unknown>> aria-label="Amendments" columns={columns} data={rows.map((row, position) => ({ ...row, _position: position }))} getRowId={(row) => String(row.amendmentId ?? row._position)} density="compact" state={rows.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">This order has not been amended.</p>} />
    </ProcPanel>
  );
}

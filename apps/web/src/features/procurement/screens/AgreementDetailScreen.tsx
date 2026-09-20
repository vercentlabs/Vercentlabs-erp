"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataGrid, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listRecords, type ProcRecord } from "@/features/procurement/shared/api";
import { DocumentDetail } from "@/features/procurement/shared/DocumentDetail";
import { money, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";
import { ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { agreementDetail } from "@/features/procurement/configs/agreements";

// F077/F078: an agreement and how much of it has been called off.
export function AgreementDetailScreen({ id }: { id: string }) {
  const config = { ...agreementDetail, sections: [{ id: "consumption", label: "Consumption", render: (record: ProcRecord) => <Consumption record={record} /> }] };
  return <DocumentDetail config={config} id={id} />;
}

function Consumption({ record }: { record: ProcRecord }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-orders", "for-agreement", record.id), queryFn: () => listRecords("purchase-orders", { limit: 200 }).then((r) => r.rows.filter((row) => row.agreementId === record.id)) });
  const orders = (query.data ?? []).filter((order) => !["cancelled", "rejected"].includes(order.status));
  const committed = (Array.isArray(record.lines) ? record.lines : []).reduce((sum: number, line: Record<string, unknown>) => sum + Number(line.quantity ?? 0), 0);
  const ordered = orders.reduce((sum, order) => sum + (Array.isArray(order.lines) ? order.lines : []).reduce((s: number, line: Record<string, unknown>) => s + Number(line.quantity ?? 0), 0), 0);
  const value = orders.reduce((sum, order) => sum + Number(order.totals?.grandTotal ?? 0), 0);
  const columns: ColumnDef<ProcRecord, unknown>[] = [
    { id: "number", header: "Order", cell: ({ row }) => <Link href={`/procurement/orders/${row.original.id}`} className="font-medium text-brand hover:underline">{String(row.original.purchaseOrderNumber ?? row.original.id)}</Link> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "total", header: "Total", accessorFn: (r) => money(r.currencyCode, r.totals?.grandTotal) },
  ];
  return (
    <ProcPanel title="Call-off orders" description="Orders raised under this agreement (cancelled and rejected orders excluded).">
      <ProcFacts columns={3} items={[{ label: "Committed quantity", value: quantity(committed) }, { label: "Ordered so far", value: quantity(ordered) }, { label: "Order value so far", value: money(record.currencyCode, value) }]} />
      <EnterpriseDataGrid<ProcRecord> aria-label="Call-off orders" columns={columns} data={orders} getRowId={(row) => row.id} density="compact" state={query.isLoading ? "loading" : orders.length ? "ready" : "empty"} loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No orders have been raised under this agreement.</p>} />
    </ProcPanel>
  );
}

"use client";

// Production activity across orders: material issues and returns, production entries, quality decisions and finished-goods receipts,
// newest first. A row opens its order.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, productionActivity, qty, type MoActivity } from "../api/mo-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "materials", label: "Issues & returns" }, { id: "production", label: "Production" }, { id: "quality", label: "Quality" }, { id: "receipts", label: "Receipts" }];

export function ProductionActivityScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const initial = useSearchParams().get("kind");
  const [view, setView] = useState(VIEWS.some((entry) => entry.id === initial) ? initial! : "all");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "activity", view), queryFn: () => productionActivity(view) });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<MoActivity, unknown>[]>(() => [
    { id: "at", header: "When", cell: ({ row }) => formatDateTime(row.original.at) },
    { id: "kind", accessorKey: "kind", header: "Activity" },
    { id: "number", accessorKey: "number", header: "Document" },
    { id: "order", accessorKey: "orderNumber", header: "Order" },
    { id: "item", accessorKey: "item", header: "Item" },
    { id: "quantity", header: "Quantity", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantity)}</span> },
    { id: "note", accessorKey: "note", header: "Detail" },
    { id: "actor", accessorKey: "actor", header: "By" },
  ], []);
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to manufacturing orders" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage header={{ title: "Production Activity", description: "Every issue to production, return, output report, quality decision and finished-goods receipt, across orders." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}>
      <EnterpriseDataGrid<MoActivity>
        aria-label="Production activity" columns={columns} data={paged.pageRows} getRowId={(row) => `${row.kind}-${row.id}`}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading activity" rows={8} />}
        errorContent={<ErrorState title="Could not load activity" description={errorMessage(query.error)} />}
        emptyContent={<EmptyState title="No production activity yet" description="Issues, output and receipts appear here as orders run." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${MO_BASE}/${row.orderId}`)}
      />
    </EnterpriseListPage>
  );
}

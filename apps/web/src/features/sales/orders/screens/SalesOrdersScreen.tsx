"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge, type ActiveFilter } from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { listSalesOrders, type SalesOrderRow } from "@/features/sales/orders/api/orders-api";

const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "confirmed", label: "Confirmed" },
  { value: "on_hold", label: "On hold" },
  { value: "cancelled", label: "Cancelled" },
  { value: "closed", label: "Closed" },
];

// F042/F043 -- the sales-order register. Search and status are applied
// server-side; the domain layer scopes rows to the caller's company.
export function SalesOrdersScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const canCreate = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(SALES_PERMISSIONS.orderCreate);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "orders", status, search),
    queryFn: () => listSalesOrders({ status: status === "all" ? undefined : status, search: search.trim() || undefined }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.rows ?? [];
  const denied = query.isError && query.error instanceof SalesApiError && query.error.status === 403;

  const columns: ColumnDef<SalesOrderRow, unknown>[] = useMemo(
    () => [
      { id: "number", header: "Order", accessorKey: "sales_order_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.sales_order_number}</span> },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "status", header: "Status", accessorKey: "lifecycle_status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.lifecycle_status)}>{statusLabel(row.original.lifecycle_status)}</StatusBadge> },
      { id: "fulfilment", header: "Fulfilment", accessorKey: "fulfillment_status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.fulfillment_status)}>{statusLabel(row.original.fulfillment_status)}</StatusBadge> },
      { id: "billing", header: "Billing", accessorKey: "billing_status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.billing_status)}>{statusLabel(row.original.billing_status)}</StatusBadge> },
      { id: "delivery", header: "Delivery by", accessorFn: (row) => calendarDate(row.requested_delivery_date) },
      { id: "total", header: "Total", accessorFn: (row) => money(row.currency_code, row.grand_total) },
    ],
    [],
  );

  const activeFilters: ActiveFilter[] = [];
  if (status !== "all") activeFilters.push({ id: "status", label: `Status: ${statusLabel(status)}` });
  if (search.trim()) activeFilters.push({ id: "search", label: `Search: ${search.trim()}` });
  const hasFilters = activeFilters.length > 0;
  function clearFilters() {
    setStatus("all");
    setSearch("");
  }

  if (denied) return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;

  return (
    <EnterpriseListPage
      header={{
        title: "Sales orders",
        description: "Customer commitments — approval, credit check, holds, amendments, fulfilment and invoicing.",
        primaryAction: canCreate ? (
          <Button variant="primary" onPress={() => router.push("/sales/orders/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New order
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search sales orders" placeholder="Search number or customer…" value={search} onChange={setSearch} className="min-w-[280px]" />
            <Select aria-label="Status" size="compact" options={STATUS_OPTIONS} selectedKey={status} onSelectionChange={(key) => setStatus(String(key ?? "all"))} />
          </>
        ),
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => (id === "status" ? setStatus("all") : setSearch("")),
        onClearAll: hasFilters ? clearFilters : undefined,
      }}
    >
      <EnterpriseDataGrid<SalesOrderRow>
        aria-label="Sales orders"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && hasFilters ? "no-results" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading sales orders…</p>}
        emptyContent={<NoResultsState title="No sales orders yet" description="Convert an accepted quotation or create an order directly." action={canCreate ? { label: "New order", onPress: () => router.push("/sales/orders/new") } : undefined} />}
        noResultsContent={<NoResultsState title="No sales orders match these filters" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clearFilters }} />}
        errorContent={<ErrorState title="Could not load sales orders" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        onRowClick={(row) => router.push(`/sales/orders/${row.id}`)}
      />
    </EnterpriseListPage>
  );
}

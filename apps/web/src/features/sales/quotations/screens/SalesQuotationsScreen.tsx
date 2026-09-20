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
import { listSalesQuotations, type SalesQuotationRow } from "@/features/sales/quotations/api/quotations-api";

const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "viewed", label: "Viewed by customer" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];

// F036 -- the quotation register. Search and status are applied server-side
// (listQuotations' own filters); the domain layer scopes rows to the caller's
// company and redacts margin, so nothing here re-derives access.
export function SalesQuotationsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const canCreate = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(SALES_PERMISSIONS.quotationCreate);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotations", status, search),
    queryFn: () => listSalesQuotations({ status: status === "all" ? undefined : status, search: search.trim() || undefined }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.rows ?? [];
  const denied = query.isError && query.error instanceof SalesApiError && query.error.status === 403;

  const columns: ColumnDef<SalesQuotationRow, unknown>[] = useMemo(
    () => [
      { id: "number", header: "Quotation", accessorKey: "quotation_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.quotation_number}</span> },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "version", header: "Version", accessorFn: (row) => `v${row.version_number}` },
      { id: "status", header: "Status", accessorKey: "lifecycle_status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.lifecycle_status)}>{statusLabel(row.original.lifecycle_status)}</StatusBadge> },
      { id: "valid", header: "Valid until", accessorFn: (row) => calendarDate(row.valid_until) },
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
        title: "Quotations",
        description: "Priced, versioned offers to customers — from draft through approval, sending and acceptance.",
        primaryAction: canCreate ? (
          <Button variant="primary" onPress={() => router.push("/sales/quotations/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New quotation
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search quotations" placeholder="Search number or customer…" value={search} onChange={setSearch} className="min-w-[280px]" />
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
      <EnterpriseDataGrid<SalesQuotationRow>
        aria-label="Quotations"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && hasFilters ? "no-results" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading quotations…</p>}
        emptyContent={<NoResultsState title="No quotations yet" description="Create a quotation to send a priced offer to a customer." action={canCreate ? { label: "New quotation", onPress: () => router.push("/sales/quotations/new") } : undefined} />}
        noResultsContent={<NoResultsState title="No quotations match these filters" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clearFilters }} />}
        errorContent={<ErrorState title="Could not load quotations" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        onRowClick={(row) => router.push(`/sales/quotations/${row.id}`)}
      />
    </EnterpriseListPage>
  );
}

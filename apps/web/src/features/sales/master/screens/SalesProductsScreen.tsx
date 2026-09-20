"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge, type ActiveFilter } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { listItems, type ItemRecord } from "@/features/sales/master/api/master-api";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Archived" },
  { value: "all", label: "All" },
];

// F033 -- the catalogue a salesperson sells from. Read-only here: items are
// maintained in inventory setup. Standard cost is only present in the data when
// the server judged the caller allowed to see margin information.
export function SalesProductsScreen() {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "products", status, search), queryFn: () => listItems({ status, search: search.trim() || undefined }), placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const showCost = rows.some((row) => row.standardCost !== undefined);
  const denied = query.isError && query.error instanceof SalesApiError && query.error.status === 403;

  const columns: ColumnDef<ItemRecord, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "type", header: "Type", accessorFn: (row) => statusLabel(row.itemType) },
      { id: "hsn", header: "HSN / SAC", accessorFn: (row) => row.hsnSacCode ?? "—" },
      { id: "price", header: "List price", accessorFn: (row) => money("", row.salesPrice) },
      ...(showCost ? [{ id: "cost", header: "Standard cost", accessorFn: (row: ItemRecord) => money("", row.standardCost) }] : []),
      { id: "stock", header: "Stock-tracked", accessorFn: (row) => (row.trackInventory ? "Yes" : "No") },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status === "active" ? "confirmed" : "cancelled")}>{row.original.status === "active" ? "Active" : "Archived"}</StatusBadge> },
    ],
    [showCost],
  );

  const filters: ActiveFilter[] = [];
  if (status !== "active") filters.push({ id: "status", label: `Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}` });
  if (search.trim()) filters.push({ id: "search", label: `Search: ${search.trim()}` });
  function clear() {
    setStatus("active");
    setSearch("");
  }
  if (denied) return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;

  return (
    <EnterpriseListPage
      header={{ title: "Products & services", description: "The catalogue you quote and sell from. Prices per customer and price list are managed under Price Lists." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search products" placeholder="Search code, name, HSN, barcode…" value={search} onChange={setSearch} className="min-w-[280px]" />
            <Select aria-label="Status" size="compact" options={STATUS_OPTIONS} selectedKey={status} onSelectionChange={(key) => setStatus(String(key ?? "active"))} />
          </>
        ),
      }}
      filterBar={{ filters, onRemove: (id) => (id === "status" ? setStatus("active") : setSearch("")), onClearAll: filters.length ? clear : undefined }}
    >
      <EnterpriseDataGrid<ItemRecord>
        aria-label="Products and services"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && filters.length ? "no-results" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading products…</p>}
        emptyContent={<NoResultsState title="No products yet" description="Items are created in inventory setup." />}
        noResultsContent={<NoResultsState title="No products match" description="Try clearing a filter." action={{ label: "Clear filters", onPress: clear }} />}
        errorContent={<ErrorState title="Could not load products" action={{ label: "Retry", onPress: () => query.refetch() }} />}
      />
    </EnterpriseListPage>
  );
}

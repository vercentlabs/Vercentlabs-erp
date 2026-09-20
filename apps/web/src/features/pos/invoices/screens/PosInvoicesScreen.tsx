"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, SearchField, Select, StatusBadge, type ActiveFilter, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listPosInvoices, type PosInvoiceListRow } from "@/features/pos/invoices/api/invoices-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { dateTime, money, statusLabel, statusTone } from "@/features/pos/shared/format";

const ALL = "all";

// F290 -- a read-only ledger of every generated POS tax invoice, each
// linking back to its source sale's receipt (the receipt screen is where
// generation and reprint both happen; this is the searchable list). The
// store filter is applied server-side (listPosInvoices' own storeId
// param); the search box narrows the rows already loaded, matching
// invoice number, receipt number and customer.
export function PosInvoicesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [storeId, setStoreId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: () => listPosStores() });
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "invoices", storeId),
    queryFn: () => listPosInvoices({ storeId }),
  });

  const storeOptions: SelectOption[] = useMemo(
    () => [{ value: ALL, label: "All stores" }, ...(storesQuery.data?.rows ?? []).map((store) => ({ value: store.id, label: store.name }))],
    [storesQuery.data],
  );

  const allRows = query.data?.rows;
  const rows = useMemo(() => {
    const source = allRows ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((row) => [row.invoice_number, row.receipt_number, row.customer_name].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [allRows, search]);

  const activeFilters: ActiveFilter[] = [];
  if (storeId) activeFilters.push({ id: "store", label: `Store: ${storesQuery.data?.rows.find((store) => store.id === storeId)?.name ?? "selected"}` });
  if (search.trim()) activeFilters.push({ id: "search", label: `Search: ${search.trim()}` });
  const hasFilters = activeFilters.length > 0;

  function removeFilter(id: string) {
    if (id === "store") setStoreId(undefined);
    if (id === "search") setSearch("");
  }
  function clearAll() {
    setStoreId(undefined);
    setSearch("");
  }

  const columns: ColumnDef<PosInvoiceListRow, unknown>[] = useMemo(
    () => [
      { id: "invoice", header: "Invoice", accessorKey: "invoice_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.invoice_number}</span> },
      { id: "receipt", header: "Receipt", accessorKey: "receipt_number" },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "generated", header: "Generated", accessorFn: (row) => dateTime(row.invoice_generated_at) },
      { id: "due", header: "Due", accessorFn: (row) => (row.due_date ? row.due_date.slice(0, 10) : "—") },
      { id: "total", header: "Total", accessorFn: (row) => money(row.currency_code, row.grand_total) },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.invoice_status)}>{statusLabel(row.original.invoice_status)}</StatusBadge> },
    ],
    [],
  );

  return (
    <EnterpriseListPage
      header={{ title: "Invoices", description: "Formal tax invoices generated for completed POS sales." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search invoices" placeholder="Search invoice, receipt or customer…" value={search} onChange={setSearch} className="min-w-[340px]" />
            <Select
              aria-label="Store"
              size="compact"
              options={storeOptions}
              selectedKey={storeId ?? ALL}
              onSelectionChange={(key) => setStoreId(key === ALL || key == null ? undefined : String(key))}
            />
          </>
        ),
      }}
      filterBar={{ filters: activeFilters, onRemove: removeFilter, onClearAll: hasFilters ? clearAll : undefined }}
    >
      <EnterpriseDataGrid<PosInvoiceListRow>
        aria-label="POS invoices"
        columns={columns}
        data={rows}
        getRowId={(row) => row.invoice_id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && hasFilters ? "no-results" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading invoices…</p>}
        emptyContent={<NoResultsState title="No invoices yet" description="Invoices appear here once you generate one from a completed sale's receipt." />}
        noResultsContent={<NoResultsState title="No invoices match these filters" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clearAll }} />}
        errorContent={<ErrorState title="Could not load invoices" description="Something went wrong fetching the invoice list." action={{ label: "Retry", onPress: () => query.refetch() }} />}
        onRowClick={(row) => router.push(`/pos/receipts/${row.sale_id}`)}
      />
    </EnterpriseListPage>
  );
}

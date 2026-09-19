"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  type ActiveFilter,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosTransactions } from "@/features/pos/transactions/api/transactions-api";
import type { PosTransactionListFilters, PosTransactionRow } from "@/features/pos/transactions/types/transactions";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals } from "@/features/pos/terminals/api/terminals-api";
import { listPosEligibleCashiers } from "@/features/pos/cashiers/api/cashiers-api";
import { money } from "@/features/pos/shared/format";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  completed: "success",
  partially_returned: "warning",
  returned: "warning",
  voided: "danger",
};

const accountingTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending: "warning",
  posted: "success",
  failed: "danger",
  not_applicable: "neutral",
};

export function PosTransactionsScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Omit<PosTransactionListFilters, "search" | "sortBy" | "sortDir" | "limit" | "offset">>({});
  const [sorting, setSorting] = useState<SortingState>([{ id: "sale_date", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  const cashiersQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers"), queryFn: listPosEligibleCashiers });

  const queryFilters: PosTransactionListFilters = useMemo(
    () => ({
      ...filters,
      search: search.trim() || undefined,
      sortBy: (sorting[0]?.id as PosTransactionListFilters["sortBy"]) || "sale_date",
      sortDir: sorting[0]?.desc === false ? "asc" : "desc",
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    }),
    [filters, search, sorting, pageIndex],
  );

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "transactions", queryFilters),
    queryFn: () => listPosTransactions(queryFilters),
    placeholderData: (previous) => previous,
  });

  const storeOptions = useMemo(() => (storesQuery.data?.rows ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })), [storesQuery.data]);
  const terminalOptions = useMemo(
    () =>
      (terminalsQuery.data?.rows ?? [])
        .filter((t) => !filters.storeId || (t.storeId ?? t.store_id) === filters.storeId)
        .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, filters.storeId],
  );
  const cashierOptions = useMemo(
    () => (cashiersQuery.data?.rows ?? []).map((c) => ({ value: c.id, label: c.fullName })),
    [cashiersQuery.data],
  );

  function setFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setPageIndex(0);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.storeId) active.push({ id: "storeId", label: `Store: ${storeOptions.find((s) => s.value === filters.storeId)?.label ?? filters.storeId}` });
    if (filters.terminalId) active.push({ id: "terminalId", label: `Terminal: ${terminalOptions.find((t) => t.value === filters.terminalId)?.label ?? filters.terminalId}` });
    if (filters.cashierId) active.push({ id: "cashierId", label: `Cashier: ${cashierOptions.find((c) => c.value === filters.cashierId)?.label ?? filters.cashierId}` });
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.paymentMethod) active.push({ id: "paymentMethod", label: `Payment: ${filters.paymentMethod}` });
    if (filters.dateFrom) active.push({ id: "dateFrom", label: `From: ${filters.dateFrom}` });
    if (filters.dateTo) active.push({ id: "dateTo", label: `To: ${filters.dateTo}` });
    return active;
  }, [filters, storeOptions, terminalOptions, cashierOptions]);

  const columns: ColumnDef<PosTransactionRow, unknown>[] = useMemo(
    () => [
      {
        id: "receipt_number",
        header: "Receipt #",
        accessorKey: "receipt_number",
        cell: ({ row }) => <span className="font-medium text-text">{row.original.receipt_number}</span>,
      },
      { id: "sale_date", header: "Date", accessorFn: (row) => new Date(row.sale_date).toLocaleString() },
      { id: "store_name", header: "Store", accessorFn: (row) => `${row.store_name} / ${row.terminal_name}`, enableSorting: false },
      { id: "cashier_name", header: "Cashier", accessorFn: (row) => row.cashier_name ?? "—", enableSorting: false },
      { id: "customer_name", header: "Customer", accessorFn: (row) => row.customer_name ?? "Walk-in", enableSorting: false },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue()).replace("_", " ")}</StatusBadge>,
      },
      {
        id: "accounting_posting_status",
        header: "Accounting",
        accessorKey: "accounting_posting_status",
        enableSorting: false,
        cell: ({ getValue }) => <StatusBadge tone={accountingTone[String(getValue())] ?? "neutral"}>{String(getValue()).replace("_", " ")}</StatusBadge>,
      },
      { id: "grand_total", header: "Total", accessorFn: (row) => money(row.currency_code, row.grand_total) },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof PosApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Transactions",
        description: "Search completed POS sales and drill into a single transaction's payments, stock movement, accounting posting and returns.",
      }}
      actionBar={{
        start: (
          <>
            <SearchField
              aria-label="Search by receipt number"
              placeholder="Search receipt #…"
              value={search}
              onChange={(value) => {
                setPageIndex(0);
                setSearch(value);
              }}
              className="min-w-[220px]"
            />
            <Select
              aria-label="Store"
              size="compact"
              options={[{ value: "", label: "Any store" }, ...storeOptions]}
              selectedKey={filters.storeId ?? ""}
              onSelectionChange={(key) => setFilter("storeId", key ? String(key) : undefined)}
            />
            <Select
              aria-label="Terminal"
              size="compact"
              options={[{ value: "", label: "Any terminal" }, ...terminalOptions]}
              selectedKey={filters.terminalId ?? ""}
              onSelectionChange={(key) => setFilter("terminalId", key ? String(key) : undefined)}
            />
            <Select
              aria-label="Cashier"
              size="compact"
              options={[{ value: "", label: "Any cashier" }, ...cashierOptions]}
              selectedKey={filters.cashierId ?? ""}
              onSelectionChange={(key) => setFilter("cashierId", key ? String(key) : undefined)}
            />
            <Select
              aria-label="Status"
              size="compact"
              options={[
                { value: "", label: "Any status" },
                { value: "completed", label: "Completed" },
                { value: "partially_returned", label: "Partially returned" },
                { value: "returned", label: "Returned" },
                { value: "voided", label: "Voided" },
              ]}
              selectedKey={filters.status ?? ""}
              onSelectionChange={(key) => setFilter("status", key ? String(key) : undefined)}
            />
            <Select
              aria-label="Payment method"
              size="compact"
              options={[
                { value: "", label: "Any payment method" },
                { value: "cash", label: "Cash" },
                { value: "card", label: "Card" },
                { value: "upi", label: "UPI" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "wallet", label: "Wallet" },
                { value: "store_credit", label: "Store credit" },
              ]}
              selectedKey={filters.paymentMethod ?? ""}
              onSelectionChange={(key) => setFilter("paymentMethod", key ? String(key) : undefined)}
            />
            <input
              aria-label="From date"
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(event) => setFilter("dateFrom", event.target.value || undefined)}
              className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm text-text"
            />
            <input
              aria-label="To date"
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(event) => setFilter("dateTo", event.target.value || undefined)}
              className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm text-text"
            />
          </>
        ),
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilter(id as keyof typeof filters, undefined),
        onClearAll: activeFilters.length > 0 ? () => setFilters({}) : undefined,
      }}
    >
      <EnterpriseDataGrid<PosTransactionRow>
        aria-label="POS transactions"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/pos/transactions/${row.id}`)}
        state={gridState}
        sorting={sorting}
        onSortingChange={setSorting}
        manualSorting
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading transactions…</p>}
        emptyContent={<NoResultsState title="No transactions found" description="Try widening your date range or clearing filters." />}
        errorContent={
          <ErrorState
            title="Could not load transactions"
            description={query.error instanceof PosApiError ? query.error.message : "Something went wrong while loading transactions."}
            action={{ label: "Retry", onPress: () => query.refetch() }}
          />
        }
        permissionDeniedContent={<PermissionState title="You don't have access to POS transactions" />}
      />
    </EnterpriseListPage>
  );
}

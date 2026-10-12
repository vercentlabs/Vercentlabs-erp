"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  type ActiveFilter,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  LinkButton,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  TextField,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosTransactions } from "@/features/pos/transactions/api/transactions-api";
import type {
  PosTransactionListFilters,
  PosTransactionRow,
} from "@/features/pos/transactions/types/transactions";
import { listPosStores } from "@/features/pos/shared/stores";
import { listPosTerminals } from "@/features/pos/shared/terminals";
import { listPosEligibleCashiers } from "@/features/pos/shared/cashiers";
import { dateTime, money, statusLabel } from "@/features/pos/shared/format";

const PAGE_SIZE = 25;
const RECEIPT_CODE = /^POSR[0-9A-F]{10}$/i;
const day = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const PRESETS: Record<string, () => { dateFrom?: string; dateTo?: string }> = {
  today: () => ({ dateFrom: day(), dateTo: day() }), yesterday: () => ({ dateFrom: day(-1), dateTo: day(-1) }), week: () => ({ dateFrom: day(-6), dateTo: day() }),
  any: () => ({ dateFrom: undefined, dateTo: undefined }),
};

const statusTone: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  completed: "success",
  partially_returned: "warning",
  returned: "warning",
  voided: "danger",
};

const accountingTone: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  pending: "warning",
  posted: "success",
  failed: "danger",
  not_applicable: "neutral",
};

export function PosTransactionsScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [preset, setPreset] = useState("any");
  const [filters, setFilters] = useState<
    Omit<
      PosTransactionListFilters,
      "search" | "sortBy" | "sortDir" | "limit" | "offset"
    >
  >({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "sale_date", desc: true },
  ]);
  const [pageIndex, setPageIndex] = useState(0);

  const storesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "stores"),
    queryFn: listPosStores,
  });
  const terminalsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "terminals"),
    queryFn: listPosTerminals,
  });
  const cashiersQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers"),
    queryFn: listPosEligibleCashiers,
  });

  const queryFilters: PosTransactionListFilters = useMemo(
    () => ({
      ...filters,
      search: search.trim() || undefined,
      customer: customer.trim() || undefined,
      amount: /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? amount.trim() : undefined,
      sortBy:
        (sorting[0]?.id as PosTransactionListFilters["sortBy"]) || "sale_date",
      sortDir: sorting[0]?.desc === false ? "asc" : "desc",
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    }),
    [filters, search, customer, amount, sorting, pageIndex],
  );

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "transactions", queryFilters),
    queryFn: () => listPosTransactions(queryFilters),
    placeholderData: (previous) => previous,
  });

  const storeOptions = useMemo(
    () =>
      (storesQuery.data?.rows ?? []).map((s) => ({
        value: s.id,
        label: `${s.name} (${s.code})`,
      })),
    [storesQuery.data],
  );
  const terminalOptions = useMemo(
    () =>
      (terminalsQuery.data?.rows ?? [])
        .filter(
          (t) =>
            !filters.storeId || (t.storeId ?? t.store_id) === filters.storeId,
        )
        .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, filters.storeId],
  );
  const cashierOptions = useMemo(
    () =>
      (cashiersQuery.data?.rows ?? []).map((c) => ({
        value: c.id,
        label: c.fullName,
      })),
    [cashiersQuery.data],
  );

  function setFilter<K extends keyof typeof filters>(
    key: K,
    value: (typeof filters)[K],
  ) {
    setPageIndex(0);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  // A scanned receipt code finds one sale: open it. An amount or a name never opens a sale on its own.
  const scanned = RECEIPT_CODE.test(search.trim()) && rows.length === 1 && !query.isFetching ? rows[0].id : null;
  useEffect(() => { if (scanned) router.push(`/pos/transactions/${scanned}`); }, [scanned, router]);

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.storeId)
      active.push({
        id: "storeId",
        label: `Store: ${storeOptions.find((s) => s.value === filters.storeId)?.label ?? filters.storeId}`,
      });
    if (filters.terminalId)
      active.push({
        id: "terminalId",
        label: `Terminal: ${terminalOptions.find((t) => t.value === filters.terminalId)?.label ?? filters.terminalId}`,
      });
    if (filters.cashierId)
      active.push({
        id: "cashierId",
        label: `Cashier: ${cashierOptions.find((c) => c.value === filters.cashierId)?.label ?? filters.cashierId}`,
      });
    if (filters.status)
      active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.paymentMethod)
      active.push({
        id: "paymentMethod",
        label: `Payment: ${filters.paymentMethod}`,
      });
    if (filters.customerMode)
      active.push({ id: "customerMode", label: `Customer: ${filters.customerMode === "walk_in" ? "Walk-in" : "Registered"}` });
    if (filters.dateFrom)
      active.push({ id: "dateFrom", label: `From: ${filters.dateFrom}` });
    if (filters.dateTo)
      active.push({ id: "dateTo", label: `To: ${filters.dateTo}` });
    return active;
  }, [filters, storeOptions, terminalOptions, cashierOptions]);

  const columns: ColumnDef<PosTransactionRow, unknown>[] = useMemo(
    () => [
      {
        id: "receipt_number",
        header: "Receipt #",
        accessorKey: "receipt_number",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium text-text">{row.original.invoice_number ?? row.original.receipt_number}</span>
            {row.original.invoice_number && <span className="text-xs text-text-muted">{row.original.receipt_number}</span>}
          </span>
        ),
      },
      {
        id: "sale_date",
        header: "Date",
        accessorFn: (row) => dateTime(row.sale_date),
      },
      {
        id: "store_name",
        header: "Store",
        accessorFn: (row) => `${row.store_name} / ${row.terminal_name}`,
        enableSorting: false,
      },
      {
        id: "cashier_name",
        header: "Cashier",
        accessorFn: (row) => row.cashier_name ?? "—",
        enableSorting: false,
      },
      {
        id: "customer_name",
        header: "Customer",
        // A walk-in sale has no customer record; a buyer name given for its invoice is shown with it.
        accessorFn: (row) => {
          const name = row.customer_mode === "walk_in" || !row.customer_id ? (row.customer_display && row.customer_display !== "Walk-in customer" ? `Walk-in · ${row.customer_display}` : "Walk-in")
            : row.customer_display ?? row.customer_name ?? "Customer";
          return row.customer_phone_masked ? `${name} · ${row.customer_phone_masked}` : name;
        },
        enableSorting: false,
      },
      {
        id: "payment_methods",
        header: "Paid by",
        accessorFn: (row) => (row.payment_methods ?? []).map((method) => (method === "upi" ? "UPI" : method.replace("_", " ").replace(/^./, (c) => c.toUpperCase()))).join(" + ") || "—",
        enableSorting: false,
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => (
          <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>
            {statusLabel(String(getValue()))}
          </StatusBadge>
        ),
      },
      {
        id: "accounting_posting_status",
        header: "Accounting",
        accessorKey: "accounting_posting_status",
        enableSorting: false,
        cell: ({ getValue }) => (
          <StatusBadge tone={accountingTone[String(getValue())] ?? "neutral"}>
            {statusLabel(String(getValue()))}
          </StatusBadge>
        ),
      },
      {
        id: "grand_total",
        header: "Total",
        accessorFn: (row) => money(row.currency_code, row.grand_total),
      },
      {
        id: "receipt",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation">
            <LinkButton variant="ghost" size="compact" href={`/pos/receipts/${row.original.id}`}>View receipt</LinkButton>
          </div>
        ),
      },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError &&
        query.error instanceof PosApiError &&
        query.error.status === 403
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
        description:
          "Find a sale by receipt number, reference, scanned receipt code, date, amount or customer — then view or reprint its receipt.",
      }}
      actionBar={{
        start: (
          <>
            <SearchField
              aria-label="Search by receipt number, sale reference or scanned receipt code"
              placeholder="Receipt number, reference or scan…"
              value={search}
              onChange={(value) => {
                setPageIndex(0);
                setSearch(value);
              }}
              className="min-w-[220px]"
            />
            <SearchField
              aria-label="Customer name, code or phone"
              placeholder="Customer…"
              value={customer}
              onChange={(value) => { setPageIndex(0); setCustomer(value); }}
              className="min-w-[160px]"
            />
            <TextField
              aria-label="Exact amount"
              placeholder="Amount"
              inputMode="decimal"
              size="compact"
              value={amount}
              onChange={(value) => { setPageIndex(0); setAmount(value); }}
            />
            <Select
              aria-label="Date range"
              size="compact"
              options={[{ value: "any", label: "Any date" }, { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "Last 7 days" },
                { value: "custom", label: "Custom dates" }]}
              selectedKey={preset}
              onSelectionChange={(key) => {
                const next = String(key);
                setPreset(next);
                if (PRESETS[next]) { setPageIndex(0); setFilters((current) => ({ ...current, ...PRESETS[next]() })); }
              }}
            />
            <Select
              aria-label="Store"
              size="compact"
              options={[{ value: "", label: "Any store" }, ...storeOptions]}
              selectedKey={filters.storeId ?? ""}
              onSelectionChange={(key) =>
                setFilter("storeId", key ? String(key) : undefined)
              }
            />
            <Select
              aria-label="Terminal"
              size="compact"
              options={[
                { value: "", label: "Any terminal" },
                ...terminalOptions,
              ]}
              selectedKey={filters.terminalId ?? ""}
              onSelectionChange={(key) =>
                setFilter("terminalId", key ? String(key) : undefined)
              }
            />
            <Select
              aria-label="Cashier"
              size="compact"
              options={[{ value: "", label: "Any cashier" }, ...cashierOptions]}
              selectedKey={filters.cashierId ?? ""}
              onSelectionChange={(key) =>
                setFilter("cashierId", key ? String(key) : undefined)
              }
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
              onSelectionChange={(key) =>
                setFilter("status", key ? String(key) : undefined)
              }
            />
            <Select
              aria-label="Payment method"
              size="compact"
              options={[
                { value: "", label: "Any payment method" },
                { value: "cash", label: "Cash" },
                { value: "card", label: "Card" },
                { value: "upi", label: "UPI" },
                { value: "split", label: "Split (several methods)" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "wallet", label: "Wallet" },
                { value: "store_credit", label: "Store credit" },
              ]}
              selectedKey={filters.paymentMethod ?? ""}
              onSelectionChange={(key) =>
                setFilter("paymentMethod", key ? String(key) : undefined)
              }
            />
            <Select
              aria-label="Customer"
              size="compact"
              options={[
                { value: "", label: "Walk-in and registered" },
                { value: "walk_in", label: "Walk-in" },
                { value: "registered", label: "Registered customers" },
              ]}
              selectedKey={filters.customerMode ?? ""}
              onSelectionChange={(key) => setFilter("customerMode", key ? (String(key) as "walk_in" | "registered") : undefined)}
            />
            {preset === "custom" && (
              <>
                <TextField
                  aria-label="From date"
                  type="date"
                  size="compact"
                  value={filters.dateFrom ?? ""}
                  onChange={(value) => setFilter("dateFrom", value || undefined)}
                />
                <TextField
                  aria-label="To date"
                  type="date"
                  size="compact"
                  value={filters.dateTo ?? ""}
                  onChange={(value) => setFilter("dateTo", value || undefined)}
                />
              </>
            )}
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
        loadingContent={
          <p className="px-4 py-8 text-sm text-text-secondary">
            Loading transactions…
          </p>
        }
        emptyContent={
          <NoResultsState
            title="No transactions found"
            description="Try widening your date range or clearing filters."
          />
        }
        errorContent={
          <ErrorState
            title="Could not load transactions"
            description={
              query.error instanceof PosApiError
                ? query.error.message
                : "Something went wrong while loading transactions."
            }
            action={{ label: "Retry", onPress: () => query.refetch() }}
          />
        }
        permissionDeniedContent={
          <PermissionState title="You don't have access to POS transactions" />
        }
      />
    </EnterpriseListPage>
  );
}

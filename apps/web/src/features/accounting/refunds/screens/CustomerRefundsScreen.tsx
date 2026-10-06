"use client";

// Finance → Customer Refunds: money paid back to customers out of their
// credit, by view (Draft, Posted, Reversed / Cancelled), searchable by
// refund, customer, credit note, receipt and invoice number and by the bank
// reference. A refund starts from a credit source: here, or with Refund
// Credit on a credit note.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, TextField, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { AccountingApiError, useAccountingOptions } from "@/features/accounting/shared/client";
import { calendarDate, money } from "@/features/accounting/shared/format";

import { listRefunds, type RefundRow, type RefundSourceType } from "../api/refunds-api";
import { CreateRefundDialog, RefundStatusBadge } from "../components/RefundDialogs";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "partyId" | "paymentMethod" | "bankAccountId" | "reasonCode" | "currencyCode" | "dateFrom" | "dateTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { partyId: ANY, paymentMethod: ANY, bankAccountId: ANY, reasonCode: ANY, currencyCode: "", dateFrom: "", dateTo: "" };
const NAMES: Record<FilterKey, string> = { partyId: "Customer", paymentMethod: "Method", bankAccountId: "Account", reasonCode: "Reason", currencyCode: "Currency", dateFrom: "Dated from", dateTo: "Dated to" };

// Mounted under Finance and, for the same records, under Sales → Refunds: basePath keeps navigation inside the module it was opened from.
export function CustomerRefundsScreen({ basePath = "/accounting/customer-refunds" }: { basePath?: string } = {}) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const options = useAccountingOptions();
  const [view, setViewState] = useState(params.get("view") || "all");
  const [search, setSearch] = useState("");
  const [submitted, setSubmittedState] = useState("");
  const [filters, setFiltersState] = useState<Filters>(NO_FILTERS);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "created", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  // Refund Credit on a credit note (or a receipt) arrives here with the source named.
  const presetType = params.get("sourceType") as RefundSourceType | null;
  const preset = presetType && params.get("sourceId") && params.get("partyId") ? { partyId: params.get("partyId")!, sourceType: presetType, sourceId: params.get("sourceId")! } : undefined;
  // ?create=1 (Sales → + Create → Refund) opens the dialog to choose the customer's credit.
  const [creating, setCreating] = useState(Boolean(preset) || params.get("create") === "1");
  const scope = { creditNoteId: params.get("creditNoteId") ?? undefined, receiptId: params.get("receiptId") ?? undefined };
  const setView = (next: string) => { setViewState(next); setPageIndex(0); };
  const setFilters = (next: Filters) => { setFiltersState(next); setPageIndex(0); };
  const setSorting = (next: SortingState) => { setSortingState(next); setPageIndex(0); };
  const setSubmitted = (next: string) => { if (next !== submitted) { setSubmittedState(next); setPageIndex(0); } };
  useEffect(() => {
    const timer = setTimeout(() => setSubmitted(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const listFilters = useMemo(() => ({
    view, search: submitted || undefined, ...scope,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scope comes from the URL
  }), [view, submitted, filters, sorting, scope.creditNoteId, scope.receiptId]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "customer-refunds", listFilters, pageIndex),
    queryFn: () => listRefunds({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<RefundRow, unknown>[]>(() => [
    { id: "number", accessorKey: "refund_number", header: "Refund", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.refund_number}</span> },
    { id: "customer", accessorKey: "customer_name", header: "Customer", cell: ({ row }) => row.original.customer_name },
    { id: "date", accessorKey: "refund_date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.refund_date)}</span> },
    { id: "amount", accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.amount)} {row.original.currency_code}</span> },
    { id: "source", header: "Source", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.source_number}</span> },
    { id: "method", header: "Method", enableSorting: false, cell: ({ row }) => row.original.paymentMethodLabel },
    { id: "account", header: "Bank / cash account", enableSorting: false, cell: ({ row }) => row.original.bank_account_name ?? "" },
    { id: "reference", header: "Reference", enableSorting: false, cell: ({ row }) => row.original.external_reference ?? "" },
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <RefundStatusBadge status={row.original.status} label={row.original.statusLabel} /> },
  ], []);

  if (listQuery.isError && listQuery.error instanceof AccountingApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to customer refunds" description="Ask an administrator for the View customer refunds permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    partyId: (options.data?.customers ?? []).map((customer) => ({ value: customer.id, label: customer.name })),
    paymentMethod: (listQuery.data?.methods ?? []).map((method) => ({ value: method.code, label: method.label })),
    bankAccountId: (listQuery.data?.accounts ?? []).map((account) => ({ value: account.id, label: account.account_name })),
    reasonCode: (listQuery.data?.reasons ?? []).map((reason) => ({ value: reason.code, label: reason.label })),
  };
  const select = (key: FilterKey, anyLabel: string) => (
    <Select key={key} aria-label={NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const field = (key: FilterKey, type: "date" | "text", width: string) => (
    <TextField key={key} aria-label={NAMES[key]} type={type} size="compact" value={filters[key]} onChange={(value) => setFilters({ ...filters, [key]: type === "text" ? value.toUpperCase().slice(0, 3) : value })}
      className={width} placeholder={NAMES[key]} />
  );
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] && filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const scoped = Boolean(scope.creditNoteId || scope.receiptId);
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all" || scoped;
  const views = listQuery.data?.views ?? [{ key: "all", label: "All Refunds" }];
  const canCreate = Boolean(listQuery.data?.capabilities.create && listQuery.data?.capabilities.creditView);
  const closeCreate = () => { setCreating(false); if (preset || params.get("create")) router.replace(basePath); };

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Customer Refunds",
          description: "Money paid back to customers out of credit they really have: what is left on a posted credit note, or unapplied on a receipt. Credit can also be applied to an invoice instead.",
          primaryAction: canCreate ? <Button variant="primary" onPress={() => setCreating(true)}>New Refund</Button> : undefined,
        }}
        savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search refunds" placeholder="Search refund, customer, credit note, receipt, invoice or bank reference" className="w-full sm:w-96"
                value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
              {select("partyId", "Any customer")}
              {select("paymentMethod", "Any method")}
              {(listQuery.data?.accounts.length ?? 0) > 0 && select("bankAccountId", "Any account")}
              {select("reasonCode", "Any reason")}
              {field("currencyCode", "text", "w-28")}
              {field("dateFrom", "date", "w-40")}
              {field("dateTo", "date", "w-40")}
            </>
          ),
        }}
        filterBar={activeFilters.length || scoped ? {
          filters: [...activeFilters, ...(scoped ? [{ id: "scope", label: "Showing one credit source's refunds" }] : [])],
          onRemove: (id) => (id === "scope" ? router.push(basePath) : setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] })),
          onClearAll: () => { setFilters(NO_FILTERS); if (scoped) router.push(basePath); },
        } : undefined}
      >
        <EnterpriseDataGrid<RefundRow>
          aria-label="Customer refunds"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading refunds" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load refunds" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={<EmptyState title="No refunds yet" description="A refund pays back a customer's credit. Start one here, or with Refund Credit on a posted credit note."
            action={canCreate ? { label: "New Refund", onPress: () => setCreating(true) } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          onRowClick={(row) => router.push(`${basePath}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium tabular-nums">{row.refund_number}</span>
              <span className="text-xs text-text-muted">{[row.customer_name, row.source_number, calendarDate(row.refund_date)].filter(Boolean).join(" · ")}</span>
              <span className="flex flex-wrap items-center gap-2"><RefundStatusBadge status={row.status} label={row.statusLabel} /><span className="text-sm tabular-nums">{money(row.amount)} {row.currency_code}</span></span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {creating && <CreateRefundDialog preset={preset} partyId={params.get("create") === "1" ? params.get("partyId") ?? undefined : undefined} onClose={closeCreate} onDone={(refundId) => router.push(`${basePath}/${refundId}`)} />}
    </>
  );
}

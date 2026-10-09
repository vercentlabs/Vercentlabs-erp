"use client";

// Procurement › Planning & Control › Invoice Matching: every purchase-order bill with its latest 2-way or 3-way match — ordered, received
// and billed quantities, expected against billed amount, and the variance. Views (?view=all | two_way | three_way | matched | exceptions)
// and filters live in the URL. Matching is decided on the bill (its Matching tab); this workbench only finds the bills that need it.
import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { getPurchaseOrderOptions } from "@/features/procurement/purchase-orders/api/purchase-orders-api";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { ProcApiError, request } from "@/features/procurement/shared/http";
import { filterBarOf, optionLabel, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type MatchRow = {
  id: string; billNumber: string; supplierInvoiceNumber: string | null; billDate: string; status: string; supplier: string | null; purchaseOrderId: string;
  purchaseOrderNumber: string; scope: "two_way" | "three_way" | null; result: string | null; approvedVariances: number; ordered: string; received: string; billed: string;
  expected: string | null; actual: string | null; variance: string | null; currency: string; evaluatedAt: string | null; href: string; orderHref: string;
};
type Matching = { rows: MatchRow[]; counts: Record<string, number>; views: Array<{ key: string; label: string }>; view: string };

const ALL = "__all";
const RESULT: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  matched: { label: "Matched", tone: "success" }, approved_exception: { label: "Variance approved", tone: "info" }, mismatch: { label: "Exception", tone: "danger" },
  pending_receipt: { label: "Awaiting receipt", tone: "warning" },
};
const SCOPE: Record<string, string> = { two_way: "2-way", three_way: "3-way" };
const amount = (row: MatchRow, value: string | null) => <span className="tabular-nums">{value === null ? "—" : money(row.currency, value)}</span>;

export function InvoiceMatchingScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = { view: params.get("view") ?? "all", supplierId: params.get("supplierId") ?? "", search: params.get("search") ?? "" };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ALL || (key === "view" && value === "all")) next.delete(key);
    else next.set(key, value);
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const matching = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "invoice-matching", query),
    queryFn: () => request<{ matching: Matching }>(`/invoice-matching${query ? `?${query}` : ""}`).then((result) => result.matching), placeholderData: (previous) => previous });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-order-options"), queryFn: getPurchaseOrderOptions, retry: false });
  const data = matching.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "billDate", desc: true }] });
  const columns = useMemo<ColumnDef<MatchRow, unknown>[]>(() => [
    { id: "billNumber", accessorKey: "billNumber", header: "Bill", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.billNumber}</span>
        {row.original.supplierInvoiceNumber && <span className="text-xs text-text-muted">{row.original.supplierInvoiceNumber}</span>}</span>
    ) },
    { id: "supplier", accessorKey: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplier ?? "" },
    { id: "purchaseOrderNumber", accessorKey: "purchaseOrderNumber", header: "Purchase order", cell: ({ row }) => (
      <Link className="text-brand hover:underline" href={row.original.orderHref} onClick={(event) => event.stopPropagation()}>{row.original.purchaseOrderNumber}</Link>
    ) },
    { id: "billDate", accessorKey: "billDate", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.billDate)}</span> },
    { id: "scope", accessorKey: "scope", header: "Match", cell: ({ row }) => (row.original.scope ? SCOPE[row.original.scope] : "") },
    { id: "result", accessorKey: "result", header: "Result", cell: ({ row }) => {
      const result = row.original.result ? RESULT[row.original.result] : undefined;
      return (
        <span className="flex flex-col gap-0.5">{result ? <StatusBadge tone={result.tone}>{result.label}</StatusBadge> : <StatusBadge tone="neutral">Not evaluated</StatusBadge>}
          {row.original.approvedVariances > 0 && row.original.result !== "approved_exception" && <span className="text-xs text-text-muted">{row.original.approvedVariances} variance{row.original.approvedVariances === 1 ? "" : "s"} approved</span>}</span>
      );
    } },
    { id: "ordered", accessorKey: "ordered", header: "Ordered", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.ordered)}</span> },
    { id: "received", accessorKey: "received", header: "Received", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.received)}</span> },
    { id: "billed", accessorKey: "billed", header: "Billed", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.billed)}</span> },
    { id: "expected", accessorKey: "expected", header: "Expected", cell: ({ row }) => amount(row.original, row.original.expected) },
    { id: "actual", accessorKey: "actual", header: "Billed amount", cell: ({ row }) => amount(row.original, row.original.actual) },
    { id: "variance", accessorKey: "variance", header: "Variance", cell: ({ row }) => (
      <span className={row.original.variance && Number(row.original.variance) !== 0 ? "text-danger" : undefined}>{amount(row.original, row.original.variance)}</span>
    ) },
  ], []);

  if (matching.error instanceof ProcApiError && matching.error.status === 403)
    return <PermissionState title="You don't have access to invoice matching" description="It needs permission to view supplier bills." />;
  const filterBar = filterBarOf([
    { id: "supplier", active: Boolean(filters.supplierId), label: `Supplier: ${optionLabel(options.data?.suppliers, filters.supplierId)}`, clear: () => set("supplierId", "") },
  ], paged.resetPage);

  return (
    <EnterpriseListPage
      header={{ title: "Invoice Matching", description: "Purchase-order bills against what was ordered and received. Open a bill to review its match, approve a variance or correct it." }}
      savedViews={{
        views: (data?.views ?? [{ key: "all", label: "All bills" }]).map((entry) => ({ id: entry.key, label: entry.label, count: data?.counts[entry.key] })),
        activeViewId: filters.view, onSelect: (id) => { set("view", id); paged.resetPage(); },
      }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search" placeholder="Bill, supplier invoice, PO or supplier" className="w-full sm:w-80" value={filters.search} onChange={(value) => set("search", value)} />
            <Select aria-label="Supplier" size="compact" selectedKey={filters.supplierId || ALL} onSelectionChange={(value) => set("supplierId", String(value))}
              options={[{ value: ALL, label: "All suppliers" }, ...(options.data?.suppliers ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<MatchRow>
        aria-label="Invoice matching"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={matching.isLoading ? "loading" : matching.isError ? "error" : rows.length === 0 ? (filterBar || filters.search || filters.view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading bills" rows={8} />}
        errorContent={<ErrorState title="Could not load invoice matching" description={matching.error instanceof Error ? matching.error.message : undefined} action={{ label: "Retry", onPress: () => matching.refetch() }} />}
        emptyContent={<EmptyState title="No purchase-order bills yet" description="Bills created from purchase orders appear here with their match against the order and receipts." />}
        noResultsContent={<NoResultsState title="No bills here" description="No purchase-order bills match this view and these filters." />}
        {...paged.grid}
        onRowClick={(row) => router.push(row.href)}
      />
    </EnterpriseListPage>
  );
}

"use client";

// Sales › Billing › Payments Received (Line-by-line audit, Sales plan): every payment a customer made, with the bills it paid; New payment
// takes the customer's payment and applies it oldest first (or from an invoice's Record Payment). The search, dates and page live in the address.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, request } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";
import { SalesCreateMenu } from "@/features/sales/shared/SalesCreateMenu";

type PaymentRow = {
  id: string; receipt_number: string; receipt_date: string; amount: number; currency_code: string; methodLabel: string | null; external_reference: string | null;
  status: string; unapplied_amount: number; party_id: string; customer_name: string | null; invoices: Array<{ id: string; number: string; amount: string }>;
};
const PAGE_SIZE = 25;

export function SalesPaymentsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const submitted = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const pageIndex = Math.max(0, (Number(params.get("page")) || 1) - 1);
  const go = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, value); else query.delete(key);
    if (!("page" in next)) query.delete("page");
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  useEffect(() => {
    const timer = setTimeout(() => { if (search.trim() !== submitted) go({ q: search.trim() }); }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "payments", submitted, from, to, pageIndex),
    queryFn: () => request<{ rows: PaymentRow[]; total: number }>(`/payments?${new URLSearchParams({ search: submitted, from, to, limit: String(PAGE_SIZE), offset: String(pageIndex * PAGE_SIZE) })}`),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(() => [
    { id: "number", header: "Receipt", cell: ({ row }) => <span className="font-medium tabular-nums whitespace-nowrap">{row.original.receipt_number}</span> },
    { id: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.receipt_date)}</span> },
    { id: "customer", header: "Customer", cell: ({ row }) => <Link className="hover:underline" href={`/sales/customers/${row.original.party_id}`} onClick={(event) => event.stopPropagation()}>{row.original.customer_name ?? ""}</Link> },
    { id: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{money(row.original.currency_code, row.original.amount)}</span> },
    { id: "method", header: "How", cell: ({ row }) => [row.original.methodLabel, row.original.external_reference].filter(Boolean).join(" · ") },
    {
      id: "invoices", header: "Paid invoices", cell: ({ row }) => (
        <span className="flex flex-wrap gap-2">
          {row.original.invoices.map((invoice) => <Link key={invoice.id} className="text-brand hover:underline tabular-nums" href={`/sales/invoices/${invoice.id}?tab=payments`} onClick={(event) => event.stopPropagation()}>{invoice.number}</Link>)}
          {row.original.unapplied_amount > 0.005 && <span className="text-xs text-text-muted">{money(row.original.currency_code, row.original.unapplied_amount)} not applied</span>}
        </span>
      ),
    },
    { id: "status", header: "Status", cell: ({ row }) => (row.original.status === "reversed" ? <span className="text-danger">Reversed</span> : "Received") },
  ], []);
  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to payments" description="Ask an administrator for the View invoice payments permission." />;
  const hasCriteria = Boolean(submitted || from || to);
  const canRecord = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.invoice.record_payment");
  return (
    <EnterpriseListPage
      header={{ title: "Payments Received", description: "What customers paid, the bills each payment settled and what is kept as an advance.",
        primaryAction: canRecord ? <LinkButton variant="primary" href="/sales/payments/new">New payment</LinkButton> : <SalesCreateMenu /> }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search payments" placeholder="Search receipt, reference or customer" className="w-full sm:w-80" value={search} onChange={setSearch} onSubmit={(value) => go({ q: value.trim() })} />
            <TextField aria-label="Received from" type="date" size="compact" className="w-40" value={from} onChange={(value) => go({ from: value })} />
            <TextField aria-label="Received to" type="date" size="compact" className="w-40" value={to} onChange={(value) => go({ to: value })} />
          </>
        ),
      }}
    >
      <EnterpriseDataGrid<PaymentRow>
        aria-label="Payments received"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading payments" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load payments" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No payments yet" description="Record what a customer paid: it settles their oldest bills first." action={canRecord ? { label: "New payment", onPress: () => router.push("/sales/payments/new") } : { label: "Invoices with a balance", onPress: () => router.push("/sales/invoices?view=balance_due") }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different search or dates." />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={(page) => go({ page: page > 0 ? String(page + 1) : "" })}
        onRowClick={(row) => router.push(`/sales/payments/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.receipt_number} · {money(row.currency_code, row.amount)}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, calendarDate(row.receipt_date), row.invoices.map((invoice) => invoice.number).join(", ")].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

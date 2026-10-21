"use client";

// Supplier bills, as Finance sees them: what each supplier is owed, when it falls due, and what is already in a payment. Bills are recorded
// in Procurement; here they are paid. "Pay" opens a payment for that supplier and bill; supplier credits open in Procurement, where they are
// applied or refunded.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { BILL_STATUS, errorMessage, errorStatus, inr, listPayableBills, type PayableBill } from "../api/payables-api";

const VIEWS = [{ id: "open", label: "To pay" }, { id: "overdue", label: "Overdue" }, { id: "due_soon", label: "Due this week" }, { id: "credits", label: "Supplier credits" },
  { id: "paid", label: "Paid" }, { id: "all", label: "All" }];

export function PayableBillsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const partyId = params.get("partyId") ?? undefined;
  const [view, setView] = useState(params.get("view") ?? "open");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { view, partyId, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "payables", filters), queryFn: () => listPayableBills(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const mayPay = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.payments.manage");
  const mayBill = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.payables.manage");
  const total = rows.filter((row) => row.type !== "credit_note").reduce((sum, row) => sum + row.baseOutstanding, 0);

  const columns: ColumnDef<PayableBill, unknown>[] = [
    { id: "number", accessorKey: "number", header: "Bill", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>
        <span className="text-xs text-text-muted">{row.original.type === "credit_note" ? "Supplier credit" : row.original.supplierInvoice ? `Invoice ${row.original.supplierInvoice}` : ""}</span></span>) },
    { id: "party", accessorKey: "party", header: "Supplier", cell: ({ row }) => (
      <Link className="text-text hover:text-brand hover:underline" href={`/accounting/statements/supplier/${row.original.partyId}`} onClick={(event) => event.stopPropagation()}>{row.original.party}</Link>) },
    { id: "dueDate", accessorKey: "dueDate", header: "Due", cell: ({ row }) => (
      <span className="flex flex-col whitespace-nowrap tabular-nums">{formatDate(row.original.dueDate)}
        {row.original.daysOverdue > 0 && <span className="text-xs text-danger">{row.original.daysOverdue} days late</span>}</span>) },
    { id: "total", accessorKey: "total", header: "Total", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.total, row.original.currency)}</span> },
    { id: "outstanding", accessorKey: "outstanding", header: "Still owed", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums"><span className="font-medium">{inr(row.original.outstanding, row.original.currency)}</span>
        {row.original.inPayment > 0 && <span className="text-xs text-info">{inr(row.original.inPayment, row.original.currency)} in a payment</span>}</span>) },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => {
      const status = BILL_STATUS[row.original.status] ?? { label: row.original.status, tone: "neutral" as const };
      return <StatusBadge tone={status.tone}>{row.original.type === "credit_note" && row.original.outstanding > 0 ? "Credit to use" : status.label}</StatusBadge>;
    } },
    { id: "act", header: "", enableSorting: false, enableHiding: false, cell: ({ row }) => mayPay && row.original.type !== "credit_note" && row.original.outstanding > 0
      && ["posted", "partially_paid", "overdue", "disputed"].includes(row.original.status)
      ? <LinkButton size="compact" variant="secondary" href={`/accounting/payments/new?partyId=${row.original.partyId}&billId=${row.original.id}`}>Pay</LinkButton> : null },
  ];

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Supplier Bills",
        description: "What you owe suppliers: bills recorded here or in Procurement, and the payments prepared, approved and applied against them.",
        primaryAction: mayPay ? <LinkButton href={`/accounting/payments/new${partyId ? `?partyId=${partyId}` : ""}`} variant="primary"><Plus className="size-4" aria-hidden="true" />Pay supplier</LinkButton> : undefined,
        secondaryActions: <>
          {mayBill && <LinkButton href="/accounting/supplier-invoices/new" variant="secondary"><Plus className="size-4" aria-hidden="true" />New bill</LinkButton>}
          <LinkButton href="/accounting/payables-aging" variant="secondary">Aging</LinkButton>
        </>,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search bills" placeholder="Bill, supplier invoice or supplier" className="w-full sm:w-72" value={search} onChange={setSearch} /> }}
      filterBar={filterBarOf([{ id: "party", active: Boolean(partyId), label: `Supplier: ${rows[0]?.party ?? "one supplier"}`, clear: () => router.replace("/accounting/supplier-invoices") }])}
    >
      <div className="flex flex-col gap-3">
        {view !== "credits" && view !== "paid" && rows.length > 0 && (
          <p className="text-sm text-text-secondary">{rows.filter((row) => row.type !== "credit_note").length} bill(s) · <span className="font-medium tabular-nums text-text">{inr(total)}</span> still owed</p>
        )}
        <EnterpriseDataGrid<PayableBill>
          aria-label="Supplier bills" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading supplier bills" rows={8} />}
          errorContent={<ErrorState title="Could not load supplier bills" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title={view === "overdue" ? "Nothing is overdue" : view === "due_soon" ? "Nothing falls due this week" : view === "open" ? "Nothing to pay" : "No bills here"}
            description="Bills appear here once they are posted, here or in Procurement." />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          {...paged.grid}
          onRowClick={(row) => router.push(row.href)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><span className="tabular-nums">{inr(row.outstanding, row.currency)}</span></span>
              <span className="text-xs text-text-muted">{row.party} · due {formatDate(row.dueDate)}{row.daysOverdue > 0 ? ` · ${row.daysOverdue} days late` : ""}{row.inPayment > 0 ? " · in a payment" : ""}</span>
            </div>
          )}
        />
      </div>
    </EnterpriseListPage>
  );
}

"use client";

// Expenses: what is waiting for approval, what is still owed (to a supplier or to an employee who paid from their own pocket), drafts and
// those sent back, my own, posted, and cancelled or reversed. A row opens the expense; Record expense starts a new one.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Paperclip, Plus, Tags } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { EXPENSE_STATE, errorMessage, errorStatus, inr, listExpenses, type Expense } from "../api/expenses-api";

export function ExpensesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { view: view === "all" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expenses", filters), queryFn: () => listExpenses(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.expenses ?? [], [list.data]);
  const counts = list.data?.counts;
  const paged = usePagedRows(rows);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const views = [
    { id: "all", label: "All" },
    { id: "to_approve", label: counts?.toApprove ? `Awaiting approval · ${counts.toApprove}` : "Awaiting approval" },
    { id: "to_pay", label: counts?.toPay ? `To pay · ${counts.toPay}` : "To pay" },
    { id: "drafts", label: counts?.drafts ? `Drafts and sent back · ${counts.drafts}` : "Drafts and sent back" },
    { id: "mine", label: "Mine" }, { id: "posted", label: "Posted" }, { id: "closed", label: "Cancelled / reversed" },
  ];

  const columns: ColumnDef<Expense, unknown>[] = [
    { id: "number", accessorKey: "number", header: "Expense", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span><span className="text-xs text-text-muted">{formatDate(row.original.date)}</span></span>) },
    { id: "description", accessorKey: "description", header: "For", cell: ({ row }) => (
      <span className="flex min-w-48 flex-col"><span className="line-clamp-1">{row.original.description}</span>
        <span className="text-xs text-text-muted">{row.original.category?.name ?? row.original.expenseAccount.label}</span></span>) },
    { id: "payee", header: "Paid to / by", cell: ({ row }) => (
      <span className="flex flex-col"><span>{row.original.payee ?? "—"}</span>{row.original.claimant && <span className="text-xs text-text-muted">Paid by {row.original.claimant.name}</span>}</span>) },
    { id: "total", accessorKey: "total", header: "Amount", cell: ({ row }) => (
      <span className="flex items-center gap-1 tabular-nums">{inr(row.original.total, row.original.currency)}
        {row.original.files > 0 && <Paperclip className="size-3.5 text-text-muted" aria-label={`${row.original.files} file(s)`} />}</span>) },
    { id: "state", accessorKey: "state", header: "Status", cell: ({ row }) => <StatusBadge tone={EXPENSE_STATE[row.original.state].tone}>{EXPENSE_STATE[row.original.state].label}</StatusBadge> },
  ];

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Expenses",
        description: counts ? `Spending that isn't a supplier bill — a cab, the internet bill, a repair paid in cash. This month: ${inr(counts.thisMonth)} posted${counts.owed ? `; ${inr(counts.owed)} still owed` : ""}.`
          : "Spending that isn't a supplier bill — a cab, the internet bill, a repair paid in cash.",
        primaryAction: can("accounting.payables.manage") ? <LinkButton href="/accounting/expenses/new" variant="primary"><Plus className="size-4" aria-hidden="true" />Record expense</LinkButton> : undefined,
        secondaryActions: <LinkButton href="/accounting/expense-categories" variant="secondary"><Tags className="size-4" aria-hidden="true" />Categories</LinkButton>,
      }}
      savedViews={{ views, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search expenses" placeholder="Number, description, payee, bill no. or person" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<Expense>
        aria-label="Expenses" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading expenses" rows={8} />}
        errorContent={<ErrorState title="Could not load expenses" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No expenses yet" description="Record an expense with its receipt; it is approved by someone else and posted to its category's account." />}
        noResultsContent={<NoResultsState title="Nothing here" description={view === "to_approve" ? "Nothing is waiting for approval." : "Try another view or search."} />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/accounting/expenses/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={EXPENSE_STATE[row.state].tone}>{EXPENSE_STATE[row.state].label}</StatusBadge></span>
            <span className="line-clamp-1 text-sm">{row.description}</span>
            <span className="text-xs text-text-muted">{formatDate(row.date)} · {row.category?.name ?? "—"} · {inr(row.total, row.currency)}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

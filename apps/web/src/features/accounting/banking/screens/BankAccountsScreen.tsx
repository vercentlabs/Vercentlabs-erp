"use client";

// Bank and cash accounts: each bank account (its bank, last digits, IFSC) and each cash box (who holds it), with the balance the books show,
// how far its statements are reconciled, and how many statement lines are still to reconcile. A row opens the account.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Landmark, Plus, Wallet } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, listBankAccounts, type BankCashAccount } from "../api/banking-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "bank", label: "Bank" }, { id: "cash", label: "Cash" }, { id: "to_reconcile", label: "To reconcile" }, { id: "closed", label: "Closed" }];

export function BankAccountsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search).trim().toLowerCase();
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-accounts", "all"), queryFn: () => listBankAccounts(true) });
  const rows = useMemo(() => (list.data ?? []).filter((account) => {
    if (view === "closed" ? account.status !== "inactive" : account.status !== "active") return false;
    if (view === "bank" && account.kind !== "bank") return false;
    if (view === "cash" && account.kind !== "cash") return false;
    if (view === "to_reconcile" && account.linesToReconcile === 0) return false;
    if (!submitted) return true;
    return [account.name, account.bankName, account.accountNumber, account.ifsc, account.custodian?.name, account.ledgerAccount.label].some((value) => value?.toLowerCase().includes(submitted));
  }), [list.data, view, submitted]);
  const paged = usePagedRows(rows);
  const mayManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.bank.manage");

  const columns: ColumnDef<BankCashAccount, unknown>[] = [
    { id: "name", accessorKey: "name", header: "Account", enableHiding: false, cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {row.original.kind === "cash" ? <Wallet className="size-4 shrink-0 text-text-muted" aria-hidden="true" /> : <Landmark className="size-4 shrink-0 text-text-muted" aria-hidden="true" />}
        <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span>
          <span className="whitespace-nowrap text-xs text-text-muted">{row.original.kind === "cash" ? "Cash" : [row.original.bankName, row.original.accountNumber].filter(Boolean).join(" · ")}</span></span>
      </span>) },
    { id: "holder", header: "IFSC / held by", cell: ({ row }) => row.original.kind === "cash" ? (row.original.custodian?.name ?? "—") : (row.original.ifsc ?? "—") },
    { id: "ledger", header: "Ledger account", cell: ({ row }) => <span className="text-text-secondary">{row.original.ledgerAccount.label}</span> },
    { id: "balance", accessorKey: "balance", header: "Balance (books)", cell: ({ row }) => (
      <span className={`tabular-nums ${row.original.balance < 0 ? "text-danger" : ""}`}>{inr(row.original.balance, row.original.currency)}</span>) },
    { id: "reconciled", accessorKey: "reconciledTo", header: "Reconciled to", cell: ({ row }) => row.original.reconciledTo ? formatDate(row.original.reconciledTo) : <span className="text-text-muted">Never</span> },
    { id: "open", accessorKey: "linesToReconcile", header: "To reconcile", cell: ({ row }) => row.original.linesToReconcile > 0
      ? <StatusBadge tone="warning">{`${row.original.linesToReconcile} line${row.original.linesToReconcile === 1 ? "" : "s"}`}</StatusBadge> : <span className="text-text-muted">—</span> },
  ];

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Bank & Cash Accounts",
        description: "Your bank accounts and cash boxes. Each has its own ledger account; import a bank's statement on its account to reconcile it.",
        primaryAction: mayManage ? <LinkButton href="/accounting/bank-accounts/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New account</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search accounts" placeholder="Name, bank, last digits or person" className="w-full sm:w-72" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<BankCashAccount>
        aria-label="Bank and cash accounts" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading accounts" rows={6} />}
        errorContent={<ErrorState title="Could not load accounts" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No bank or cash accounts yet" description="Add your bank account (and any petty cash) to record receipts, payments and transfers against it." />}
        noResultsContent={<NoResultsState title="Nothing here" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/accounting/bank-accounts/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span>
              <span className="tabular-nums">{inr(row.balance, row.currency)}</span></span>
            <span className="text-xs text-text-muted">{row.kind === "cash" ? `Cash · ${row.custodian?.name ?? "no one"}` : [row.bankName, row.accountNumber].filter(Boolean).join(" · ")}
              {row.linesToReconcile > 0 ? ` · ${row.linesToReconcile} to reconcile` : ""}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

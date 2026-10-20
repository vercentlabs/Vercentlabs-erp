"use client";

// Bank reconciliation: every imported statement, newest first, with how far it is reconciled (lines settled, suggestions waiting,
// exceptions). A row opens its reconciliation; Import statement brings in the next one.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Upload } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATEMENT_STATUS, errorMessage, errorStatus, inr, listBankAccounts, listStatements, type StatementSummary } from "../api/banking-api";

const VIEWS = [{ id: "open", label: "To reconcile" }, { id: "exceptions", label: "With exceptions" }, { id: "reconciled", label: "Reconciled" }, { id: "all", label: "All" }];

export function BankStatementsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("open");
  const [accountId, setAccountId] = useState("all");
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-accounts", "all"), queryFn: () => listBankAccounts(true) });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-statements", accountId), queryFn: () => listStatements(accountId === "all" ? undefined : accountId),
    placeholderData: (previous) => previous });
  const rows = useMemo(() => (list.data ?? []).filter((statement) => view === "all" ? true : view === "reconciled" ? statement.status === "reconciled"
    : view === "exceptions" ? statement.exceptions > 0 : statement.status !== "reconciled"), [list.data, view]);
  const paged = usePagedRows(rows);
  const mayImport = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.bank.manage");

  const columns: ColumnDef<StatementSummary, unknown>[] = [
    { id: "number", accessorKey: "number", header: "Statement", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>
        {row.original.fileName && <span className="text-xs text-text-muted">{row.original.fileName}</span>}</span>) },
    { id: "account", header: "Account", cell: ({ row }) => row.original.bankAccount.name },
    { id: "period", header: "Period", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.from)} – {formatDate(row.original.to)}</span> },
    { id: "closing", accessorKey: "closing", header: "Closing", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.closing)}</span> },
    { id: "progress", header: "Progress", cell: ({ row }) => <Progress statement={row.original} /> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATEMENT_STATUS[row.original.status].tone}>{STATEMENT_STATUS[row.original.status].label}</StatusBadge> },
  ];

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Bank Reconciliation",
        description: "Import each bank statement and agree every line with your books. A statement is reconciled when every line is matched or explained.",
        primaryAction: mayImport ? <LinkButton href="/accounting/reconciliation/import" variant="primary"><Upload className="size-4" aria-hidden="true" />Import statement</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: (
        <Select aria-label="Account" className="w-full sm:w-72" selectedKey={accountId} onSelectionChange={(key) => { setAccountId(String(key)); paged.resetPage(); }}
          options={[{ value: "all", label: "All bank accounts" }, ...(accounts.data ?? []).filter((account) => account.kind === "bank").map((account) => ({ value: account.id, label: account.name }))]} />
      ) }}
    >
      <EnterpriseDataGrid<StatementSummary>
        aria-label="Bank statements" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? ((list.data ?? []).length > 0 ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading statements" rows={6} />}
        errorContent={<ErrorState title="Could not load statements" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No statement imported yet" description="Download your bank statement as CSV or Excel from net banking and import it to start reconciling." />}
        noResultsContent={<NoResultsState title="Nothing here" description={view === "open" ? "Every statement is reconciled." : "Try another view or account."} />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/accounting/reconciliation/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={STATEMENT_STATUS[row.status].tone}>{STATEMENT_STATUS[row.status].label}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.bankAccount.name} · {formatDate(row.from)} – {formatDate(row.to)}</span>
            <Progress statement={row} />
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

function Progress({ statement }: { statement: StatementSummary }) {
  const share = statement.lines ? Math.round((statement.settled / statement.lines) * 100) : 0;
  return (
    <span className="flex min-w-36 flex-col gap-1">
      <span className="text-xs text-text-secondary">{statement.settled} of {statement.lines} settled{statement.suggested ? ` · ${statement.suggested} suggested` : ""}
        {statement.exceptions ? <span className="text-danger"> · {statement.exceptions} exception{statement.exceptions === 1 ? "" : "s"}</span> : null}</span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <span className={`block h-full rounded-full ${share === 100 ? "bg-success" : "bg-brand"}`} style={{ width: `${share}%` }} /></span>
    </span>
  );
}

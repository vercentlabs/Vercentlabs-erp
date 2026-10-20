"use client";

// Customer receipts: every payment received, what it settled and what is still unapplied (an advance the customer holds). A row opens the
// receipt, where it is applied, an application undone, or the receipt reversed (a bounced cheque).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { RECEIPT_STATUS, errorMessage, errorStatus, inr, listReceipts, methodLabel, type Receipt } from "../api/receivables-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "unapplied", label: "With money to apply" }, { id: "applied", label: "Fully applied" }, { id: "reversed", label: "Reversed" }];

export function ReceiptsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { view: view === "all" ? undefined : view, search: submitted || undefined, from: from || undefined, to: to || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "receipts", filters), queryFn: () => listReceipts(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const mayReceive = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.receipts.manage");

  const columns = useMemo<ColumnDef<Receipt, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Receipt", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "date", accessorKey: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.date)}</span> },
    { id: "party", accessorKey: "party", header: "Customer" },
    { id: "method", accessorKey: "method", header: "How", cell: ({ row }) => (
      <span className="flex flex-col"><span>{methodLabel(row.original.method)}</span>{row.original.reference && <span className="text-xs text-text-muted">{row.original.reference}</span>}</span>) },
    { id: "amount", accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.amount, row.original.currency)}</span> },
    { id: "unapplied", accessorKey: "unapplied", header: "Not yet applied", cell: ({ row }) => row.original.unapplied > 0
      ? <span className="font-medium tabular-nums text-warning">{inr(row.original.unapplied, row.original.currency)}</span> : <span className="text-text-muted">—</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => {
      const status = RECEIPT_STATUS[row.original.status] ?? { label: row.original.status, tone: "neutral" as const };
      return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
    } },
  ], []);

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  const filterBar = filterBarOf([
    { id: "from", active: Boolean(from), label: `From ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `To ${formatDate(to)}`, clear: () => setTo("") },
  ], paged.resetPage);
  return (
    <EnterpriseListPage
      header={{
        title: "Receipts",
        description: "Money received from customers. Apply it to their invoices; anything not applied stays on the customer as an advance.",
        primaryAction: mayReceive ? <LinkButton href="/accounting/receipts/new" variant="primary"><Plus className="size-4" aria-hidden="true" />Record payment</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search receipts" placeholder="Receipt, customer or reference" className="w-full sm:w-72" value={search} onChange={setSearch} />
            <TextField aria-label="From" size="compact" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="To" size="compact" type="date" value={to} onChange={setTo} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<Receipt>
        aria-label="Receipts" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filterBar || submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading receipts" rows={8} />}
        errorContent={<ErrorState title="Could not load receipts" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No receipts yet" description="Record a customer's payment to apply it to their invoices." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, date or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/accounting/receipts/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={(RECEIPT_STATUS[row.status] ?? RECEIPT_STATUS.draft).tone}>{(RECEIPT_STATUS[row.status] ?? RECEIPT_STATUS.draft).label}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.party} · {formatDate(row.date)} · {inr(row.amount, row.currency)}{row.unapplied > 0 ? ` · ${inr(row.unapplied, row.currency)} to apply` : ""}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

"use client";

// Journal entries: every entry in the books — automatic (from a business transaction, linked to its document) or manual — filtered by date,
// account, document type and status. A row opens the entry; the document link opens the transaction it came from.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  ComboBox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listPostingAccounts } from "@/features/accounting/automatic/api/automatic-api";

import { amount, errorMessage, errorStatus, listJournals, statusOf, type JournalRow } from "../api/journals-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "automatic", label: "Automatic" }, { id: "manual", label: "Manual" }];
const STATUSES = [["all", "Any status"], ["posted", "Posted"], ["reversed", "Reversed"], ["draft", "Draft"], ["pending_approval", "Awaiting approval"], ["approved", "Approved"], ["rejected", "Sent back"], ["cancelled", "Discarded"]];
const DOCUMENTS = [["all", "Any document"], ["customer_invoice", "Sales invoice"], ["customer_credit_note", "Credit note"], ["customer_receipt", "Customer payment"], ["customer_refund", "Customer refund"],
  ["vendor_bill", "Supplier invoice"], ["vendor_payment", "Supplier payment"], ["goods_receipt", "Goods receipt"], ["sales_delivery", "Delivery"], ["sales_return", "Sales return"],
  ["inventory_adjustment", "Stock adjustment"], ["goods_issue", "Goods issue"], ["opening_stock", "Opening stock"], ["pos_sale", "POS sale"], ["pos_return", "POS return"],
  ["payment_settlement_batch", "Card / UPI settlement"], ["expense", "Expense"], ["fund_transfer", "Bank / cash transfer"], ["opening_balance", "Opening balances"],
  ["itc_decision", "Input tax credit"], ["manual_journal", "Manual journal"]];

export function JournalsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [status, setStatus] = useState("all");
  const [documentType, setDocumentType] = useState("all");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { origin: view === "all" ? undefined : view, search: submitted || undefined, status: status === "all" ? undefined : status,
    documentType: documentType === "all" ? undefined : documentType, accountId: accountId ?? undefined, from: from || undefined, to: to || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "journals", filters), queryFn: () => listJournals(filters), placeholderData: (previous) => previous });
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-accounts"), queryFn: listPostingAccounts, staleTime: 60_000 });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const mayCreate = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.journal.create");
  const accountLabel = (id: string) => { const account = accounts.data?.accounts.find((entry) => entry.id === id); return account ? `${account.code} · ${account.name}` : id; };

  const columns = useMemo<ColumnDef<JournalRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Journal", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "accountingDate", accessorKey: "accountingDate", header: "Posting date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.accountingDate)}</span> },
    { id: "documentLabel", accessorKey: "documentLabel", header: "Document", cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{row.original.documentLabel}</span>
        {row.original.sourceHref
          ? <Link className="text-xs text-brand underline" href={row.original.sourceHref} onClick={(event) => event.stopPropagation()}>{row.original.sourceNumber ?? "Open"}</Link>
          : row.original.sourceNumber && <span className="text-xs text-text-muted">{row.original.sourceNumber}</span>}
      </span>) },
    { id: "description", accessorKey: "description", header: "Description", cell: ({ row }) => <span className="line-clamp-2">{row.original.description}</span> },
    { id: "total", accessorKey: "total", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.total, row.original.currency?.trim() || "INR")}</span> },
    { id: "automatic", accessorKey: "automatic", header: "Origin", cell: ({ row }) => row.original.automatic ? "Automatic" : row.original.type === "reversal" ? "Reversal" : "Manual" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusOf(row.original.status).tone}>{statusOf(row.original.status).label}</StatusBadge> },
    { id: "postedBy", accessorKey: "postedBy", header: "By", cell: ({ row }) => row.original.postedBy ?? row.original.createdBy ?? "" },
  ], []);

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  const filterBar = filterBarOf([
    { id: "status", active: status !== "all", label: `Status: ${STATUSES.find(([value]) => value === status)?.[1]}`, clear: () => setStatus("all") },
    { id: "document", active: documentType !== "all", label: `Document: ${DOCUMENTS.find(([value]) => value === documentType)?.[1]}`, clear: () => setDocumentType("all") },
    { id: "account", active: Boolean(accountId), label: `Account: ${accountId ? accountLabel(accountId) : ""}`, clear: () => setAccountId(null) },
    { id: "from", active: Boolean(from), label: `From ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `To ${formatDate(to)}`, clear: () => setTo("") },
  ], paged.resetPage);
  return (
    <EnterpriseListPage
      header={{
        title: "Journal Entries",
        description: "Every entry in the books. Automatic entries come from business transactions and link back to them; manual journals are prepared and approved here.",
        primaryAction: mayCreate ? <LinkButton href="/accounting/journal-new" variant="primary"><Plus className="size-4" aria-hidden="true" />New manual journal</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search journals" placeholder="Journal, document or description" className="w-full sm:w-72" value={search} onChange={setSearch} />
            <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))} options={STATUSES.map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Document type" size="compact" selectedKey={documentType} onSelectionChange={(key) => setDocumentType(String(key))} options={DOCUMENTS.map(([value, label]) => ({ value, label }))} />
            <ComboBox aria-label="Account" size="compact" placeholder="Any account" selectedKey={accountId} onSelectionChange={(key) => setAccountId(key ? String(key) : null)}
              options={(accounts.data?.accounts ?? []).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))} />
            <TextField aria-label="From" size="compact" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="To" size="compact" type="date" value={to} onChange={setTo} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<JournalRow>
        aria-label="Journal entries" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filterBar || submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading journal entries" rows={8} />}
        errorContent={<ErrorState title="Could not load journal entries" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No journal entries yet" description="Entries appear here as soon as invoices, bills, payments and stock movements are posted." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or filter." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/accounting/journals/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={statusOf(row.status).tone}>{statusOf(row.status).label}</StatusBadge></span>
            <span className="text-xs text-text-muted">{formatDate(row.accountingDate)} · {row.documentLabel} · {amount(row.total)}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}

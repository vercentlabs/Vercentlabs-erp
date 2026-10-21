"use client";

// Customer invoices, as Finance sees them: what each customer still owes, how late, and the Sales invoice or credit note behind it.
// Invoices are raised in Sales; here they are collected. A row opens its Sales document; "Record payment" opens a receipt for that
// customer; an unapplied credit note is applied to the customer's open invoices.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  INVOICE_STATUS, applyCreditNote, cents, errorMessage, errorStatus, fromCents, inr, listReceivableInvoices, type ReceivableInvoice,
} from "../api/receivables-api";

const VIEWS = [{ id: "open", label: "Open" }, { id: "overdue", label: "Overdue" }, { id: "credit_notes", label: "Credit notes" }, { id: "paid", label: "Paid" }, { id: "all", label: "All" }];

export function ReceivableInvoicesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const partyId = params.get("partyId") ?? undefined;
  const [view, setView] = useState(params.get("view") ?? "open");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [crediting, setCrediting] = useState<ReceivableInvoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const filters = { view, partyId, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "receivables", filters), queryFn: () => listReceivableInvoices(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const mayReceive = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.receipts.manage");
  const mayInvoice = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.receivables.manage");
  const total = rows.filter((row) => row.type !== "credit_note").reduce((sum, row) => sum + row.baseOutstanding, 0);

  const columns: ColumnDef<ReceivableInvoice, unknown>[] = [
    { id: "number", accessorKey: "number", header: "Invoice", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>
        {row.original.type === "credit_note" && <span className="text-xs text-text-muted">Credit note</span>}</span>) },
    { id: "party", accessorKey: "party", header: "Customer", cell: ({ row }) => (
      <Link className="text-text hover:text-brand hover:underline" href={`/accounting/statements/customer/${row.original.partyId}`} onClick={(event) => event.stopPropagation()}>{row.original.party}</Link>) },
    { id: "date", accessorKey: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.date)}</span> },
    { id: "dueDate", accessorKey: "dueDate", header: "Due", cell: ({ row }) => (
      <span className="flex flex-col whitespace-nowrap tabular-nums">{formatDate(row.original.dueDate)}
        {row.original.daysOverdue > 0 && <span className="text-xs text-danger">{row.original.daysOverdue} days late</span>}</span>) },
    { id: "total", accessorKey: "total", header: "Total", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.total, row.original.currency)}</span> },
    { id: "outstanding", accessorKey: "outstanding", header: "Still owed", cell: ({ row }) => <span className="font-medium tabular-nums">{inr(row.original.outstanding, row.original.currency)}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => {
      const status = INVOICE_STATUS[row.original.status] ?? { label: row.original.status, tone: "neutral" as const };
      return <StatusBadge tone={status.tone}>{row.original.type === "credit_note" && row.original.outstanding > 0 ? "Credit to apply" : status.label}</StatusBadge>;
    } },
    { id: "act", header: "", enableSorting: false, enableHiding: false, cell: ({ row }) => {
      if (!mayReceive || row.original.outstanding <= 0 || !["posted", "partially_paid", "overdue", "disputed"].includes(row.original.status)) return null;
      return row.original.type === "credit_note"
        ? <Button size="compact" variant="secondary" onPress={() => { setMessage(null); setCrediting(row.original); }}>Apply credit</Button>
        : <LinkButton size="compact" variant="secondary" href={`/accounting/receipts/new?partyId=${row.original.partyId}&invoiceId=${row.original.id}`}>Record payment</LinkButton>;
    } },
  ];

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Customer Invoices",
        description: "What customers owe: invoices raised here or in Sales, and the payments recorded and applied against them.",
        primaryAction: mayReceive ? <LinkButton href={`/accounting/receipts/new${partyId ? `?partyId=${partyId}` : ""}`} variant="primary"><Plus className="size-4" aria-hidden="true" />Record payment</LinkButton> : undefined,
        secondaryActions: <>
          {mayInvoice && <LinkButton href="/accounting/customer-invoices/new" variant="secondary"><Plus className="size-4" aria-hidden="true" />New invoice</LinkButton>}
          <LinkButton href="/accounting/receivables-aging" variant="secondary">Aging</LinkButton>
        </>,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search invoices" placeholder="Invoice or customer" className="w-full sm:w-72" value={search} onChange={setSearch} /> }}
      filterBar={filterBarOf([{ id: "party", active: Boolean(partyId), label: `Customer: ${rows[0]?.party ?? "one customer"}`, clear: () => router.replace("/accounting/customer-invoices") }])}
    >
      <div className="flex flex-col gap-3">
        {message && <Notice tone="success">{message}</Notice>}
        {view !== "credit_notes" && view !== "paid" && rows.length > 0 && (
          <p className="text-sm text-text-secondary">{rows.filter((row) => row.type !== "credit_note").length} invoice(s) · <span className="font-medium text-text tabular-nums">{inr(total)}</span> still owed</p>
        )}
        <EnterpriseDataGrid<ReceivableInvoice>
          aria-label="Customer invoices" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading customer invoices" rows={8} />}
          errorContent={<ErrorState title="Could not load customer invoices" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title={view === "overdue" ? "Nothing is overdue" : view === "open" ? "Nothing is owed" : "No invoices here"} description="Invoices appear here once they are raised, here or in Sales." />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          {...paged.grid}
          onRowClick={(row) => { if (row.href) router.push(row.href); }}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
                <span className="tabular-nums">{inr(row.outstanding, row.currency)}</span></span>
              <span className="text-xs text-text-muted">{row.party} · due {formatDate(row.dueDate)}{row.daysOverdue > 0 ? ` · ${row.daysOverdue} days late` : ""}</span>
            </div>
          )}
        />
      </div>
      {crediting && <ApplyCreditDialog credit={crediting} onClose={() => setCrediting(null)} onDone={(text) => { setCrediting(null); setMessage(text); }} />}
    </EnterpriseListPage>
  );
}

function ApplyCreditDialog({ credit, onClose, onDone }: { credit: ReceivableInvoice; onClose: () => void; onDone: (text: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const open = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "receivables", { view: "open", partyId: credit.partyId }),
    queryFn: () => listReceivableInvoices({ view: "open", partyId: credit.partyId }) });
  const invoices = (open.data ?? []).filter((row) => row.type !== "credit_note" && row.currency === credit.currency);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const entered = Object.values(amounts).reduce((sum, value) => sum + cents(value), 0);
  const left = cents(credit.outstanding) - entered;
  const submitKey = useSubmitKey();
  const apply = useMutation({
    mutationFn: () => submitKey.run(() => applyCreditNote(credit.id, Object.entries(amounts).filter(([, value]) => cents(value) > 0).map(([invoiceId, value]) => ({ invoiceId, amount: fromCents(cents(value)) })))),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") }); onDone(`${credit.number} applied.`); },
  });
  const fillOldest = () => {
    let remaining = cents(credit.outstanding);
    const next: Record<string, string> = {};
    for (const invoice of invoices) { if (remaining <= 0) break; const take = Math.min(remaining, cents(invoice.outstanding)); next[invoice.id] = fromCents(take); remaining -= take; }
    setAmounts(next);
  };
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Apply ${credit.number}`} size="lg"
      description={`${credit.party} holds ${inr(credit.outstanding, credit.currency)} of credit. Apply it to invoices it still owes; any rest stays as credit.`}>
      <div className="flex flex-col gap-3">
        {Boolean(apply.error) && <Notice>{errorMessage(apply.error)}</Notice>}
        {open.isLoading ? <LoadingState label="Loading open invoices" rows={3} /> : invoices.length === 0 ? <Notice tone="neutral">This customer has no open invoice in {credit.currency}.</Notice> : (
          <>
            <div className="flex justify-end"><Button size="compact" variant="ghost" onPress={fillOldest}>Fill oldest first</Button></div>
            <ul className="flex flex-col divide-y divide-border">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-end justify-between gap-2 py-2">
                  <span className="flex min-w-0 flex-col text-sm"><span className="font-medium text-text">{invoice.number}</span>
                    <span className="text-xs text-text-muted">Due {formatDate(invoice.dueDate)} · owes {inr(invoice.outstanding, invoice.currency)}</span></span>
                  <TextField aria-label={`Amount for ${invoice.number}`} size="compact" inputMode="decimal" className="w-36" placeholder="0.00" value={amounts[invoice.id] ?? ""}
                    onChange={(value) => setAmounts((current) => ({ ...current, [invoice.id]: value }))} />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className={`text-sm tabular-nums ${left < 0 ? "text-danger" : "text-text-secondary"}`}>{left < 0 ? `${inr(-left / 100)} more than the credit has` : `${inr(left / 100)} of credit left after this`}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={apply.isPending} isDisabled={entered <= 0 || left < 0 || apply.isPending || apply.isSuccess} onPress={() => apply.mutate()}>Apply credit</Button>
        </div>
      </div>
    </Dialog>
  );
}

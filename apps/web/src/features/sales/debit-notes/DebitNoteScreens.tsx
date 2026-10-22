"use client";

// Sales › Billing › Credit & Debit Notes (Sales plan): the debit notes list and one debit note's page. A debit note is raised from its
// invoice (More › Debit note, or + Create › Debit Note).
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Eye } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricStrip, NoResultsState, PermissionState, RecordDetailsPage, SearchField, StatusBadge, buttonVariants,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";
import { WhatsAppSendButton } from "@/features/sales/shared/WhatsAppSend";

import { cancelDebitNote, debitNotePdfUrl, getDebitNote, listDebitNotes, postDebitNote, type DebitNote } from "./api";

const PAGE_SIZE = 25;
const TONE = { draft: "neutral", posted: "success", cancelled: "neutral", reversed: "warning" } as const;
const VIEWS = [{ id: "all", label: "All Debit Notes" }, { id: "draft", label: "Draft" }, { id: "posted", label: "Posted" }, { id: "cancelled", label: "Cancelled" }];

// Credit notes and debit notes are one place in the sidebar: two lists side by side.
export function NotesTabs({ current }: { current: "credit" | "debit" }) {
  const tabs = [{ id: "credit", label: "Credit notes", href: "/sales/credit-notes" }, { id: "debit", label: "Debit notes", href: "/sales/debit-notes" }];
  return (
    <nav aria-label="Credit and debit notes" className="-mb-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link href={tab.href} aria-current={tab.id === current ? "page" : undefined}
              className={`-mb-px flex border-b-2 px-3 py-2 text-sm font-medium ${tab.id === current ? "border-brand text-text" : "border-transparent text-text-secondary hover:text-text"}`}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DebitNotesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") ?? "all";
  const submitted = params.get("q") ?? "";
  const [search, setSearch] = useState(submitted);
  const pageIndex = Math.max(0, (Number(params.get("page")) || 1) - 1);
  const go = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) if (value && value !== "all") query.set(key, value); else query.delete(key);
    if (!("page" in next)) query.delete("page");
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "debit-notes", view, submitted, pageIndex),
    queryFn: () => listDebitNotes(new URLSearchParams({ status: view === "all" ? "" : view, search: submitted, limit: String(PAGE_SIZE), offset: String(pageIndex * PAGE_SIZE) })),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<DebitNote, unknown>[]>(() => [
    { id: "number", header: "Debit note", cell: ({ row }) => <span className="font-medium tabular-nums whitespace-nowrap">{row.original.number}</span> },
    { id: "date", header: "Date", cell: ({ row }) => calendarDate(row.original.date) },
    { id: "customer", header: "Customer", cell: ({ row }) => row.original.customer.name ?? "—" },
    { id: "invoice", header: "Invoice", cell: ({ row }) => <Link className="text-brand hover:underline" href={`/sales/invoices/${row.original.sourceInvoice.id}`} onClick={(event) => event.stopPropagation()}>{row.original.sourceInvoice.number}</Link> },
    { id: "reason", header: "Why", cell: ({ row }) => row.original.reasonLabel },
    { id: "total", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{money(row.original.currencyCode, row.original.total)}</span> },
    { id: "outstanding", header: "To collect", cell: ({ row }) => <span className="tabular-nums">{row.original.status === "posted" ? money(row.original.currencyCode, row.original.outstanding) : "—"}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TONE[row.original.status]}>{row.original.status === "draft" ? "Draft" : row.original.status === "posted" ? "Posted" : "Cancelled"}</StatusBadge> },
  ], []);
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to debit notes" description="Ask an administrator for the View credit notes permission." />;
  return (
    <div className="flex flex-col gap-4">
      <NotesTabs current="debit" />
      <EnterpriseListPage
        header={{ title: "Debit Notes", description: "Amounts added to posted invoices: undercharges, rate differences and missed charges. Raise one from its invoice." }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => go({ view: id }) }}
        actionBar={{ start: <SearchField aria-label="Search debit notes" placeholder="Search number, invoice or customer" className="w-full sm:w-80" value={search} onChange={setSearch} onSubmit={(value) => go({ q: value.trim() })} /> }}
      >
        <EnterpriseDataGrid<DebitNote>
          aria-label="Debit notes"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading debit notes" rows={6} />}
          errorContent={<ErrorState title="Could not load debit notes" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No debit notes" description="Open a posted invoice and choose More › Debit note when the customer was undercharged." />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE))}
          totalRowCount={query.data?.total ?? 0}
          onPageChange={(page) => go({ page: page > 0 ? String(page + 1) : "" })}
          onRowClick={(row) => router.push(`/sales/debit-notes/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium tabular-nums">{row.number} · {money(row.currencyCode, row.total)}</span>
              <span className="text-xs text-text-muted">{[row.customer.name, row.sourceInvoice.number, calendarDate(row.date)].filter(Boolean).join(" · ")}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
    </div>
  );
}

export function DebitNoteDetailScreen({ debitNoteId }: { debitNoteId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "debit-note", debitNoteId);
  const query = useQuery({ queryKey: key, queryFn: () => getDebitNote(debitNoteId) });
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: ["sales", "einvoice", debitNoteId] }); };
  const postIt = useMutation({
    mutationFn: () => postDebitNote(debitNoteId),
    onSuccess: ({ result }) => {
      setNotice(result.awaitingApproval ? "Sent to Finance for approval: it is posted once approved."
        : result.einvoice?.status === "generated" ? `Posted. IRN generated: ${result.einvoice.irn}.`
          : result.einvoice?.status === "failed" ? `Posted. The IRN could not be generated: ${result.einvoice.error} Retry from the e-invoice panel.` : "Posted. The customer owes it like a bill.");
      refresh();
    },
  });
  const cancel = useMutation({ mutationFn: () => cancelDebitNote(debitNoteId), onSuccess: () => { setNotice("The draft was cancelled."); refresh(); } });
  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Debit note not found" : "Could not load this debit note"} action={{ label: "Retry", onPress: () => void query.refetch() }} />;
  const { debitNote, lines, actions } = query.data;
  const currency = debitNote.currencyCode;
  const error = (postIt.error ?? cancel.error) as Error | null;
  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="info">{notice}</Notice>}
      {error && <Notice tone="danger">{error.message}</Notice>}
      {debitNote.financeStatus === "pending_approval" && <Notice tone="warning">Waiting for Finance approval. It is posted once approved.</Notice>}
      <RecordDetailsPage
        header={{
          title: debitNote.number,
          status: <StatusBadge tone={TONE[debitNote.status]}>{debitNote.status === "draft" ? "Draft" : debitNote.status === "posted" ? "Posted" : "Cancelled"}</StatusBadge>,
          fields: [
            { label: "Customer", value: <Link className="hover:underline" href={`/sales/customers/${debitNote.customer.id}`}>{debitNote.customer.name ?? "—"}</Link> },
            { label: "Invoice", value: <Link className="hover:underline" href={`/sales/invoices/${debitNote.sourceInvoice.id}`}>{debitNote.sourceInvoice.number}</Link> },
            { label: "Date", value: calendarDate(debitNote.date) },
            { label: "Total", value: money(currency, debitNote.total) },
            ...(debitNote.status === "posted" ? [{ label: "To collect", value: money(currency, debitNote.outstanding) }, { label: "Due", value: calendarDate(debitNote.dueDate) }] : []),
          ],
          primaryAction: actions.post ? <Button variant="primary" isLoading={postIt.isPending} onPress={() => postIt.mutate()}><Check className="size-4" aria-hidden="true" />Post debit note</Button> : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              <a className={buttonVariants({ variant: "secondary" })} href={debitNotePdfUrl(debitNoteId, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />{debitNote.status === "draft" ? "Draft PDF" : "PDF"}</a>
              {debitNote.status === "posted" && <WhatsAppSendButton kind="debit_note" id={debitNoteId} pdfUrl={debitNotePdfUrl(debitNoteId)} onSent={refresh} />}
              {actions.cancel && <Button variant="ghost" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel draft</Button>}
            </div>
          ),
        }}
      >
        <MetricStrip metrics={[{ label: "Taxable value added", value: money(currency, debitNote.subtotal) }, { label: "GST", value: money(currency, debitNote.taxTotal) }, { label: "Total", value: money(currency, debitNote.total) }]} />
        <Panel title="Items">
          <LinesTable columns={["Item", "HSN/SAC", { label: "Taxable", numeric: true }, { label: "GST", numeric: true }, { label: "Amount", numeric: true }]}>
            {lines.map((line) => (
              <tr key={line.id}>
                <Cell>{line.item_name_snapshot}</Cell>
                <Cell>{line.hsn_sac_code ?? "—"}</Cell>
                <Cell numeric>{money(currency, line.net_amount)}</Cell>
                <Cell numeric>{line.taxes.map((tax) => `${tax.tax_type.toUpperCase()} ${tax.rate}%`).join(" + ") || "—"}</Cell>
                <Cell numeric>{money(currency, line.line_total)}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
        <Panel title="Details">
          <Facts items={[
            { label: "Why", value: [debitNote.reasonLabel, debitNote.reasonNote].filter(Boolean).join(": ") },
            { label: "Customer GSTIN", value: debitNote.customer.gstin ?? "—" },
            { label: "Sales order", value: debitNote.salesOrder ? <Link className="text-brand hover:underline" href={`/sales/orders/${debitNote.salesOrder.id}`}>{debitNote.salesOrder.number}</Link> : "—" },
            { label: "Sent", value: debitNote.sentAt ? `${calendarDate(debitNote.sentAt.slice(0, 10))}${debitNote.sentChannel ? ` on ${debitNote.sentChannel}` : ""}` : "Not yet" },
          ]} />
        </Panel>
      </RecordDetailsPage>
    </div>
  );
}

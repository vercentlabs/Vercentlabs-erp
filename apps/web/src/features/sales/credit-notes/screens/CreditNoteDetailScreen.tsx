"use client";

// One credit note: the header with its status and how much of it was applied,
// and the actions open to the caller now (the server decides them and checks
// each again); then the customer and the original invoice, the items credited,
// the taxes by component, where the credit went (the invoice it was applied
// to and the customer credit left), the documents it comes from, notes and
// files, the journal entry (for those who may see the books) and the history.
// A Draft is edited and posted; a posted credit note never changes: one
// posted in error is reversed.
import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Banknote, Check, Eye, Pencil, Send, Upload, Wallet } from "lucide-react";
import {
  Button, EnterpriseDataGrid, ErrorState, LinkButton, MetricStrip, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, buttonVariants,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

import {
  creditNoteFileUrl, creditNotePdfUrl, getCreditNote, listCreditNoteFiles, removeCreditNoteFile, uploadCreditNoteFile, type CreditNoteDetail, type CreditNoteLine,
} from "../api/credit-notes-api";
import {
  CancelCreditNoteDialog, EditCreditNoteDialog, MarkCreditNoteSentDialog, PostCreditNoteDialog, ReverseCreditNoteDialog, SendCreditNoteDialog, failureText,
} from "../components/CreditNoteDialogs";
import { CreditNoteStatusBadges } from "../components/CreditNoteStatusBadges";

type Snapshot = Record<string, string | null | undefined> | null;
const addressText = (snapshot: Snapshot) =>
  snapshot ? [snapshot.label, snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postal_code ?? snapshot.postalCode].filter(Boolean).join(", ")]
    .filter(Boolean).join("\n") || "—" : "—";
const personName = (snapshot: Snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;
const quantity = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const by = (at: string | null, name: string | null) => (at ? `${dateTime(at)}${name ? ` by ${name}` : ""}` : "—");
const TAX_LABELS: Record<string, string> = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };

type DialogKind = "edit" | "post" | "cancel" | "reverse" | "send" | "markSent" | null;

const EVENT_LABELS: Record<string, string> = {
  "sales_credit_note.created": "Credit note created", "sales_credit_note.updated": "Draft changed", "sales_credit_note.submitted_for_approval": "Sent to Finance for approval",
  "sales_credit_note.posted": "Credit note posted", "sales_credit_note.cancelled": "Draft cancelled", "sales_credit_note.reversed": "Credit note reversed",
  "sales_credit_note.sent": "Credit note emailed", "sales_credit_note.marked_sent": "Marked as sent", "sales_credit_note.file_added": "File added", "sales_credit_note.file_removed": "File removed",
  "accounting.customer_credit.allocated": "Applied to invoices", "accounting.customer_credit.refunded": "Credit refunded", "accounting.customer_credit.refund_reversed": "Refund reversed", "accounting.customer_credit_note.reversed": "Reversing entry posted",
  "accounting.customer_invoice.approved": "Approved by Finance", "accounting.customer_invoice.submitted_for_approval": "Submitted to Finance",
};
function eventDetail(event: SalesDocumentEvent) {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  const lines = Array.isArray(m.lines)
    ? (m.lines as Array<Record<string, unknown>>).map((line) => (line.type === "amount" ? `${line.item ?? ""}: amount ${line.amount}` : `${line.item ?? ""} × ${quantity(line.quantity as number)}${line.unit ? ` ${line.unit}` : ""}`)).join(", ")
    : null;
  const changes = Array.isArray(m.changes)
    ? (m.changes as Array<Record<string, unknown>>).map((change) => `${change.what}: ${change.from ?? "none"} → ${change.to ?? "none"}`).join("\n")
    : null;
  const unapplied = Array.isArray(m.unapplied) ? (m.unapplied as Array<Record<string, unknown>>).map((entry) => `${entry.invoiceNumber} owes ${entry.amount} again`).join(", ") : null;
  const applied = typeof m.applied === "number" ? `Applied ${m.applied}${typeof m.customerCredit === "number" && m.customerCredit > 0 ? ` · customer credit ${m.customerCredit}` : ""}` : null;
  return [text("invoiceNumber") && `Invoice ${text("invoiceNumber")}`, text("refundNumber") && `${text("refundNumber")} · ${text("amount") ?? ""}`, text("returnNumber") && `Return ${text("returnNumber")}`, text("reason"), lines, changes, applied, unapplied,
    text("allocatedAmount") && `Applied ${text("allocatedAmount")}`, text("channel"), text("recipient") && `To ${text("recipient")}`, text("fileName"), text("note")].filter(Boolean).join(" · ");
}

export function CreditNoteDetailScreen({ creditNoteId }: { creditNoteId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "credit-note", creditNoteId);
  const query = useQuery({ queryKey: key, queryFn: () => getCreditNote(creditNoteId).then((r) => r.creditNote) });
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "credit-notes") });
    if (query.data) {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "invoice", query.data.creditNote.source_invoice_id) });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "order", query.data.creditNote.sales_order_id) });
    }
  };
  const done = (message?: string) => { setDialog(null); setNotice(message ?? null); refresh(); };

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to credit notes" description="Ask an administrator for the View credit notes permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Credit note not found" : "Could not load this credit note"}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const creditNote = detail.creditNote;
  const actions = detail.actions;
  const currency = creditNote.currency_code;
  const posted = creditNote.status === "posted";

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/credit-notes" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All credit notes
      </Link>
      {notice && <SalesAlert tone="info" className="whitespace-pre-line">{notice}</SalesAlert>}
      {creditNote.financeStatus === "pending_approval" && <SalesAlert tone="warning">This credit note is waiting for Finance approval. It is posted and applied once approved.</SalesAlert>}
      {creditNote.status === "reversed" && (
        <SalesAlert tone="warning">This credit note was reversed {by(creditNote.reversed_at, creditNote.reversed_by_name)}{creditNote.reversal_reason ? `: ${creditNote.reversal_reason}` : ""}. It is kept for the record; it credits nothing.</SalesAlert>
      )}
      {creditNote.status === "cancelled" && <SalesAlert tone="warning">This draft was cancelled. It never reached the books.</SalesAlert>}
      {creditNote.status === "draft" && detail.problems.length > 0 && (
        <SalesAlert tone="warning"><span className="font-medium">It cannot be posted yet:</span><ul className="list-disc pl-4">{detail.problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul></SalesAlert>
      )}
      {detail.warnings.map((warning, index) => <SalesAlert key={index} tone="warning">{warning.message}</SalesAlert>)}

      <RecordDetailsPage
        header={{
          title: creditNote.invoice_number,
          status: <CreditNoteStatusBadges row={creditNote} />,
          fields: [
            { label: "Customer", value: <Link className="hover:underline" href={`/sales/customers/${creditNote.party_id}`}>{creditNote.sales_customer_snapshot?.displayName ?? "—"}</Link> },
            { label: "Date", value: calendarDate(creditNote.invoice_date) },
            { label: "Invoice", value: <Link className="hover:underline" href={`/sales/invoices/${creditNote.source_invoice_id}`}>{creditNote.sourceInvoice.invoiceNumber}</Link> },
            { label: "Reason", value: creditNote.reasonLabel },
            { label: "Total credit", value: money(currency, creditNote.grand_total) },
            ...(posted && creditNote.unapplied !== null ? [{ label: "Unapplied credit", value: money(currency, creditNote.unapplied) }] : []),
          ],
          primaryAction: actions.post ? (
            <Button variant="primary" onPress={() => setDialog("post")}><Check className="size-4" aria-hidden="true" />Post Credit Note</Button>
          ) : actions.send ? (
            <Button variant="primary" onPress={() => setDialog("send")}><Send className="size-4" aria-hidden="true" />Send Credit Note</Button>
          ) : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <Button variant="secondary" onPress={() => setDialog("edit")}><Pencil className="size-4" aria-hidden="true" />Edit</Button>}
              {actions.print && <a className={buttonVariants({ variant: "secondary" })} href={creditNotePdfUrl(creditNoteId, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />{posted ? "View PDF" : "Draft PDF"}</a>}
              {actions.print && posted && <LinkButton variant="secondary" href={creditNotePdfUrl(creditNoteId)} download>Download</LinkButton>}
              {actions.markSent && <Button variant="secondary" onPress={() => setDialog("markSent")}>Mark as Sent</Button>}
              {actions.applyCredit && <LinkButton variant="secondary" href="/accounting/customer-invoices"><Wallet className="size-4" aria-hidden="true" />Apply Credit</LinkButton>}
              {actions.refund && (
                <LinkButton variant="secondary" href={`/sales/refunds?sourceType=credit_note&sourceId=${creditNote.id}&partyId=${creditNote.party_id}`}>
                  <Banknote className="size-4" aria-hidden="true" />Refund Credit
                </LinkButton>
              )}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Draft</Button>}
              {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse</Button>}
            </div>
          ),
        }}
      >
        <MetricStrip
          metrics={[
            { label: "Taxable value", value: money(currency, Number(creditNote.subtotal) - Number(creditNote.discount_total)) },
            { label: "Tax", value: money(currency, creditNote.tax_total) },
            { label: "Total credit", value: money(currency, creditNote.grand_total) },
            ...(posted && creditNote.applied !== null ? [{ label: "Applied", value: money(currency, creditNote.applied) }] : []),
            ...(posted && creditNote.refunded ? [{ label: "Refunded", value: money(currency, creditNote.refunded) }] : []),
            ...(posted && creditNote.unapplied !== null ? [{ label: "Customer credit left", value: money(currency, creditNote.unapplied) }] : []),
          ]}
        />
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Credit note sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items ({detail.lines.length})</Tab>
            <Tab id="taxes">Taxes</Tab>
            {actions.viewApplication && <Tab id="application">Application</Tab>}
            <Tab id="related">Related documents</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            {actions.viewAccounting && <Tab id="accounting">Accounting</Tab>}
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><Overview detail={detail} /></TabPanel>
          <TabPanel id="items"><Items detail={detail} /></TabPanel>
          <TabPanel id="taxes"><Taxes detail={detail} /></TabPanel>
          {actions.viewApplication && <TabPanel id="application"><Application detail={detail} /></TabPanel>}
          <TabPanel id="related"><Related detail={detail} /></TabPanel>
          <TabPanel id="notes"><Notes detail={detail} canEdit={actions.edit || actions.send} onChanged={refresh} /></TabPanel>
          {actions.viewAccounting && <TabPanel id="accounting"><Accounting detail={detail} /></TabPanel>}
          <TabPanel id="history"><History detail={detail} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "edit" && <EditCreditNoteDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was saved.")} />}
      {dialog === "post" && <PostCreditNoteDialog detail={detail} onClose={() => setDialog(null)} onDone={(message) => done(message)} />}
      {dialog === "cancel" && <CancelCreditNoteDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was cancelled.")} />}
      {dialog === "reverse" && <ReverseCreditNoteDialog detail={detail} onClose={() => setDialog(null)} onDone={(message) => done(message)} />}
      {dialog === "send" && <SendCreditNoteDialog detail={detail} onClose={() => setDialog(null)} onDone={(sentTo) => done(`The credit note was sent to ${sentTo}.`)} />}
      {dialog === "markSent" && <MarkCreditNoteSentDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The credit note is marked as sent.")} />}
    </div>
  );
}

function Overview({ detail }: { detail: CreditNoteDetail }) {
  const creditNote = detail.creditNote;
  const customer = creditNote.sales_customer_snapshot;
  const seller = creditNote.seller_snapshot;
  const currency = creditNote.currency_code;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Customer" description="As invoiced: later changes to the customer do not change this credit note.">
        <SalesFacts items={[
          { label: "Customer", value: customer?.legalName ?? customer?.displayName ?? "—" },
          { label: "Customer number", value: customer?.customerNumber ?? creditNote.customer_number ?? "—" },
          { label: "GSTIN", value: customer?.gstin ?? "—" },
          { label: "Contact", value: [personName(creditNote.contact_snapshot), creditNote.contact_snapshot?.email].filter(Boolean).join(" · ") || "—" },
          { label: "Bill to", value: <span className="whitespace-pre-line">{addressText(creditNote.billing_address_snapshot)}</span> },
        ]} />
      </SalesPanel>
      <SalesPanel title="Credit note">
        <SalesFacts items={[
          { label: "Original invoice", value: <Link className="text-brand hover:underline" href={`/sales/invoices/${creditNote.source_invoice_id}`}>{creditNote.sourceInvoice.invoiceNumber}</Link> },
          { label: "Invoice date", value: calendarDate(creditNote.sourceInvoice.invoiceDate) },
          { label: "Invoice total", value: money(currency, creditNote.sourceInvoice.grandTotal) },
          { label: "Credited on the invoice (posted)", value: money(currency, creditNote.sourceInvoice.creditedTotal) },
          { label: "Reason", value: [creditNote.reasonLabel, creditNote.reason_note].filter(Boolean).join(": ") },
          { label: "Credit note date", value: calendarDate(creditNote.invoice_date) },
          { label: "Posting date", value: calendarDate(creditNote.accounting_date) },
          { label: "Currency", value: creditNote.currency_code },
          { label: "Customer PO", value: creditNote.customer_po_number ?? "—" },
          { label: "Sent", value: creditNote.sent ? `${dateTime(creditNote.sent_at)}${creditNote.sent_to ? ` to ${creditNote.sent_to}` : ""}` : "Not sent" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Tax">
        <SalesFacts items={[
          { label: "Issued by", value: seller?.name ? `${seller.legalName ?? seller.name}${seller.gstin ? ` · GSTIN ${seller.gstin}` : ""}` : "—" },
          { label: "Place of supply", value: creditNote.place_of_supply ? `${creditNote.place_of_supply_name ?? ""} (${creditNote.place_of_supply})`.trim() : "—" },
          { label: "GST", value: ({ intra_state: "Within the state: CGST + SGST", inter_state: "Between states: IGST" } as Record<string, string>)[creditNote.supply_nature ?? ""] ?? "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Status history">
        <SalesFacts items={[
          { label: "Created", value: by(creditNote.created_at, creditNote.created_by_name) },
          { label: "Posted", value: by(creditNote.posted_at, creditNote.posted_by_name) },
          { label: "Reversed", value: by(creditNote.reversed_at, creditNote.reversed_by_name) },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Items({ detail }: { detail: CreditNoteDetail }) {
  const currency = detail.creditNote.currency_code;
  const columns: ColumnDef<CreditNoteLine, unknown>[] = [
    { id: "seq", header: "#", cell: ({ row }) => row.original.sequence },
    {
      id: "item", header: "Product / service",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className="font-medium">{row.original.item_name_snapshot}</span>
          <span className="text-xs text-text-muted">{[row.original.item_code_snapshot, row.original.hsn_sac_code && `${row.original.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${row.original.hsn_sac_code}`,
            row.original.return_number && `Return ${row.original.return_number}`].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { id: "type", header: "Credited by", cell: ({ row }) => (row.original.credit_type === "amount" ? "Amount" : "Quantity") },
    { id: "invoiced", header: "Invoiced", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{quantity(row.original.invoiced_quantity)} {row.original.uom_snapshot ?? ""} at {money(currency, row.original.invoiced_unit_price)}</span> },
    { id: "qty", header: "Quantity", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.credit_type === "amount" ? "—" : `${quantity(row.original.quantity)} ${row.original.uom_snapshot ?? ""}`}</span> },
    { id: "taxable", header: "Taxable", cell: ({ row }) => <span className="tabular-nums">{money(currency, row.original.net_amount)}</span> },
    {
      id: "tax", header: "Tax",
      cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.taxes.map((tax) => `${TAX_LABELS[tax.tax_type] ?? tax.label} ${Number(tax.rate)}% ${money(currency, tax.tax_amount)}`).join(" + ") || "No tax"}</span>,
    },
    { id: "total", header: "Amount", cell: ({ row }) => <span className="font-medium tabular-nums">{money(currency, row.original.line_total)}</span> },
  ];
  return (
    <div className="pt-4">
      <EnterpriseDataGrid<CreditNoteLine> aria-label="Credit note items" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready"
        renderMobileCard={(line) => (
          <div className="flex flex-col gap-1"><span className="font-medium">{line.item_name_snapshot}</span><span className="text-sm tabular-nums">{line.credit_type === "amount" ? "Amount" : quantity(line.quantity)} · {money(currency, line.line_total)}</span></div>
        )} />
    </div>
  );
}

function Taxes({ detail }: { detail: CreditNoteDetail }) {
  const creditNote = detail.creditNote;
  const currency = creditNote.currency_code;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Tax by component" description="The invoice line's own rates: the output tax the credit note takes back.">
        {!detail.taxSummary.length ? <p className="text-sm text-text-muted">No tax is credited.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-muted"><tr className="border-b border-border"><th className="py-2 pr-3 font-medium">Tax</th><th className="py-2 pr-3 text-right font-medium">Taxable value</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
            <tbody>
              {detail.taxSummary.map((tax) => (
                <tr key={`${tax.taxType}-${tax.rate}`} className="border-b border-border">
                  <td className="py-2 pr-3">{TAX_LABELS[tax.taxType] ?? tax.label ?? tax.taxType} {tax.rate}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(currency, tax.taxableAmount)}</td>
                  <td className="py-2 text-right tabular-nums">{money(currency, tax.taxAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SalesPanel>
      <SalesPanel title="Totals">
        <SalesFacts columns={4} items={[
          { label: "Subtotal", value: money(currency, creditNote.subtotal) },
          { label: "Discounts", value: money(currency, creditNote.discount_total) },
          { label: "Taxable value", value: money(currency, Number(creditNote.subtotal) - Number(creditNote.discount_total)) },
          { label: "Tax", value: money(currency, creditNote.tax_total) },
          { label: "Total credit", value: money(currency, creditNote.grand_total) },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Application({ detail }: { detail: CreditNoteDetail }) {
  const creditNote = detail.creditNote;
  const currency = creditNote.currency_code;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Where the credit went" description="Posting applies the credit note to its invoice for as much as the invoice still owes. What is left is the customer's credit: Finance applies it to other invoices or refunds it. The credit note's amount never changes.">
        <SalesFacts columns={4} items={[
          { label: "Credit note amount", value: money(currency, creditNote.grand_total) },
          { label: "Applied to invoices", value: creditNote.status === "posted" ? money(currency, creditNote.applied ?? 0) : "—" },
          { label: "Refunded", value: creditNote.status === "posted" ? money(currency, creditNote.refunded ?? 0) : "—" },
          { label: "Remaining credit", value: creditNote.status === "posted" ? money(currency, creditNote.unapplied ?? 0) : "—" },
          { label: "Invoice still owes", value: creditNote.sourceInvoice.outstanding === null ? "—" : money(currency, creditNote.sourceInvoice.outstanding) },
        ]} />
        {!detail.allocations.length ? <p className="text-sm text-text-muted">{creditNote.status === "posted" ? "Not applied to any invoice." : "Applied when posted."}</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.allocations.map((allocation) => (
              <li key={allocation.id} className="flex flex-wrap items-center gap-3 py-2">
                {allocation.is_sales_invoice
                  ? <Link className="font-medium text-brand hover:underline" href={`/sales/invoices/${allocation.customer_invoice_id}`}>{allocation.invoice_number}</Link>
                  : <span className="font-medium tabular-nums">{allocation.invoice_number}</span>}
                <span className="tabular-nums">{money(currency, allocation.allocated_amount)}</span>
                <span className="text-text-muted">{dateTime(allocation.allocated_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
      <SalesPanel title="Refunds" description="Money Finance paid back out of this credit. A credit note does not need a refund: its credit can be applied to another invoice instead.">
        {!detail.refunds.length ? <p className="text-sm text-text-muted">No refunds.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.refunds.map((refund) => (
              <li key={refund.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link className="font-medium tabular-nums text-brand hover:underline" href={`/sales/refunds/${refund.id}`}>{refund.refund_number}</Link>
                <StatusBadge tone={statusTone(refund.status)}>{statusLabel(refund.status)}</StatusBadge>
                <span className="tabular-nums">{money(currency, refund.amount)}</span>
                <span className="text-text-muted">{calendarDate(refund.refund_date)}{refund.external_reference ? ` · ref ${refund.external_reference}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
    </div>
  );
}

function Related({ detail }: { detail: CreditNoteDetail }) {
  const creditNote = detail.creditNote;
  const link = (href: string, label: string) => <Link className="text-brand hover:underline" href={href}>{label}</Link>;
  return (
    <div className="pt-4">
      <SalesPanel title="Related documents">
        <SalesFacts items={[
          { label: "Invoice", value: link(`/sales/invoices/${creditNote.source_invoice_id}`, creditNote.sourceInvoice.invoiceNumber) },
          { label: "Sales order", value: link(`/sales/orders/${creditNote.sales_order_id}`, creditNote.sales_order_number) },
          { label: "Return", value: creditNote.sales_return_id ? link(`/sales/returns/${creditNote.sales_return_id}`, creditNote.return_number ?? "Return") : "None" },
          { label: "Deliveries", value: detail.deliveries.length ? <span className="flex flex-wrap gap-2">{detail.deliveries.map((delivery) => <span key={delivery.id}>{link(`/sales/deliveries/${delivery.id}`, delivery.delivery_number)}</span>)}</span> : "—" },
          { label: "Refunds", value: detail.refunds.length ? <span className="flex flex-wrap gap-2">{detail.refunds.map((refund) => <span key={refund.id}>{link(`/sales/refunds/${refund.id}`, refund.refund_number)}</span>)}</span> : "None" },
          { label: "Other credit notes of the invoice", value: link(`/sales/credit-notes?invoiceId=${creditNote.source_invoice_id}`, "Show") },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Notes({ detail, canEdit, onChanged }: { detail: CreditNoteDetail; canEdit: boolean; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const creditNote = detail.creditNote;
  const filesKey = scopedQueryKey(workspace, "sales", "credit-note", creditNote.id, "files");
  const files = useQuery({ queryKey: filesKey, queryFn: () => listCreditNoteFiles(creditNote.id).then((r) => r.files) });
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const after = () => { setError(null); void queryClient.invalidateQueries({ queryKey: filesKey }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadCreditNoteFile(creditNote.id, file), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be uploaded.")) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeCreditNoteFile(creditNote.id, fileId), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be removed.")) });
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Customer notes" description="Printed on the credit note."><p className="text-sm whitespace-pre-line">{creditNote.customer_notes ?? "None"}</p></SalesPanel>
      <SalesPanel title="Internal notes" description="Never printed or shown to the customer."><p className="text-sm whitespace-pre-line">{creditNote.internal_notes ?? "None"}</p></SalesPanel>
      <SalesPanel title="Attachments" description="Files kept with the credit note, including each PDF that was emailed."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Upload</Button>
          </>
        ) : undefined}>
        {error && <SalesAlert>{error}</SalesAlert>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={creditNoteFileUrl(creditNote.id, file.id)}>{file.fileName}</a>
                <span className="text-text-muted">{dateTime(file.uploadedAt)}</span>
                {canEdit && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
    </div>
  );
}

function Accounting({ detail }: { detail: CreditNoteDetail }) {
  const creditNote = detail.creditNote;
  return (
    <div className="pt-4">
      <SalesPanel title="Accounting" description="Posting credits the customer's receivable and debits revenue and output tax: the reverse of the invoice.">
        <SalesFacts items={[
          { label: "Journal entry", value: creditNote.journal_entry_number ? <Link className="text-brand hover:underline" href="/accounting/journals">{creditNote.journal_entry_number}</Link> : "Not posted yet" },
          { label: "Reversing entry", value: creditNote.reversal_entry_number ?? "—" },
          { label: "Posting date", value: calendarDate(creditNote.accounting_date) },
          { label: "Finance status", value: statusLabel(creditNote.financeStatus) },
        ]} />
      </SalesPanel>
    </div>
  );
}

function History({ detail }: { detail: CreditNoteDetail }) {
  return (
    <div className="pt-4">
      <SalesPanel title="History">
        {!detail.events.length ? <p className="text-sm text-text-muted">No history yet.</p> : (
          <ol className="flex flex-col divide-y divide-border text-sm">
            {detail.events.map((event) => (
              <li key={`${event.event_type}-${event.id}`} className="flex flex-col gap-0.5 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{EVENT_LABELS[event.event_type] ?? statusLabel(event.event_type.split(".").pop())}</span>
                  <span className="text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
                </span>
                {eventDetail(event) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event)}</span>}
              </li>
            ))}
          </ol>
        )}
      </SalesPanel>
    </div>
  );
}

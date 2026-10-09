"use client";

// One sales invoice: the header with its status, payment status and balance
// (worked out from what Finance applied), and the actions open to the caller
// now (the server decides them and checks each again); then the customer and
// terms as invoiced, the items, the taxes by component, payments and credits,
// the documents it comes from, notes and files, the journal entry (for those
// who may see the books) and the history. A Draft is edited and posted; a
// posted invoice never changes: corrections are credit notes.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Eye, FileMinus, Pencil, Send, Upload, Wallet } from "lucide-react";
import {
  Button, EnterpriseDataGrid, ErrorState, LinkButton, MetricStrip, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, buttonVariants,
} from "@vercentlabs/design-system";

import { useCreateRequest } from "@/features/sales/shared/use-create-request";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

import {
  getInvoice, invoiceFileUrl, invoicePdfUrl, listInvoiceFiles, removeInvoiceFile, uploadInvoiceFile, type InvoiceDetail, type InvoiceLine,
} from "../api/invoices-api";
import {
  CancelInvoiceDialog, ChangeDueDateDialog, EditInvoiceDialog, MarkSentDialog, PostInvoiceDialog, ReverseInvoiceDialog, SendInvoiceDialog, failureText,
} from "../components/InvoiceDialogs";
import { InvoiceStatusBadges } from "../components/InvoiceStatusBadges";
import { CreateCreditNoteDialog } from "@/features/sales/credit-notes/components/CreditNoteDialogs";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

type Snapshot = Record<string, string | null | undefined> | null;
const addressText = (snapshot: Snapshot) =>
  snapshot ? [snapshot.label, snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postal_code ?? snapshot.postalCode].filter(Boolean).join(", "), snapshot.gstin ? `GSTIN ${snapshot.gstin}` : null]
    .filter(Boolean).join("\n") || "—" : "—";
const personName = (snapshot: Snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;
const quantity = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const by = (at: string | null, name: string | null) => (at ? `${dateTime(at)}${name ? ` by ${name}` : ""}` : "—");
const TAX_LABELS: Record<string, string> = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };

type DialogKind = "edit" | "terms" | "post" | "cancel" | "reverse" | "send" | "markSent" | "credit" | "dueDate" | null;

const EVENT_LABELS: Record<string, string> = {
  "sales_invoice.created": "Invoice created", "sales_invoice.updated": "Draft changed", "sales_invoice.submitted_for_approval": "Sent to Finance for approval",
  "sales_invoice.posted": "Invoice posted", "sales_invoice.cancelled": "Draft cancelled", "sales_invoice.reversed": "Invoice reversed", "sales_invoice.sent": "Invoice emailed",
  "sales_invoice.marked_sent": "Marked as sent", "sales_invoice.credit_note_created": "Credit note created", "sales_invoice.due_date_changed": "Due date changed", "accounting.customer_invoice.due_date_changed": "Due date changed in Finance", "sales_invoice.credit_note_posted": "Credit note posted",
  "accounting.customer_credit.applied": "Credit note applied", "accounting.customer_credit.unapplied": "Credit note unapplied", "sales_invoice.file_added": "File added", "sales_invoice.file_removed": "File removed",
  "accounting.customer_invoice.posted": "Entered in the books", "accounting.customer_invoice.reversed": "Reversing entry posted",
  "accounting.customer_invoice.approved": "Approved by Finance", "accounting.customer_invoice.submitted": "Submitted to Finance",
};
function eventDetail(event: SalesDocumentEvent) {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  const lines = Array.isArray(m.lines)
    ? (m.lines as Array<Record<string, unknown>>).map((line) => `${line.item ?? ""} × ${quantity(line.quantity as number)}${line.unit ? ` ${line.unit}` : ""}`).join(", ")
    : null;
  const changes = Array.isArray(m.changes)
    ? (m.changes as Array<Record<string, unknown>>).map((change) => `${change.what}: ${change.from ?? "none"} → ${change.to ?? "none"}`).join("\n")
    : null;
  return [text("orderNumber"), text("deliveryNumber"), lines, changes, text("from") && text("to") ? `${text("from")} → ${text("to")}` : null, text("creditNoteNumber"), text("channel"), text("recipient") && `To ${text("recipient")}`,
    text("fileName"), text("note"), text("reason")].filter(Boolean).join(" · ");
}

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "sales", "invoice", invoiceId);
  const query = useQuery({ queryKey: key, queryFn: () => getInvoice(invoiceId).then((r) => r.invoice) });
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "invoices") });
    if (query.data) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "order", query.data.invoice.sales_order_id) });
  };
  const done = (message?: string) => { setDialog(null); setNotice(message ?? null); refresh(); };

  // From Sales → + Create: open the credit note dialog when this invoice allows it.
  useCreateRequest(Boolean(query.data), (kind) => {
    if (kind !== "credit") return;
    if (query.data?.actions.creditNote) setDialog("credit"); else setNotice("A credit note cannot be created from this invoice: it must be posted, with something left to credit.");
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to sales invoices" description="Ask an administrator for the View sales invoices permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Invoice not found" : "Could not load this invoice"}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const invoice = detail.invoice;
  const actions = detail.actions;
  const currency = invoice.currency_code;
  const canChangeDates = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.invoice.change_posting_date");
  const posted = invoice.status === "posted";

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="info" className="whitespace-pre-line">{notice}</Notice>}
      {invoice.financeStatus === "pending_approval" && <Notice tone="warning">This invoice is waiting for Finance approval. It is posted once approved.</Notice>}
      {invoice.status === "reversed" && (
        <Notice tone="warning">This invoice was reversed {by(invoice.reversed_at, invoice.reversed_by_name)}{invoice.reversal_reason ? `: ${invoice.reversal_reason}` : ""}. It is kept for the record; nothing is owed on it.</Notice>
      )}
      {invoice.status === "cancelled" && <Notice tone="warning">This draft was cancelled. It never reached the books.</Notice>}
      {invoice.status === "draft" && invoice.dueDateRequired && (
        <Notice tone="warning">Payment terms &quot;{invoice.paymentTerm?.name}&quot; do not set a due date. Enter the due date (Edit) before posting this invoice.</Notice>
      )}
      {detail.draftWarnings.map((warning, index) => <Notice key={index} tone="warning">{warning.message}</Notice>)}

      <RecordDetailsPage
        header={{
          title: invoice.invoice_number,
          status: <InvoiceStatusBadges row={invoice} />,
          fields: [
            { label: "Customer", value: <Link className="hover:underline" href={`/sales/customers/${invoice.party_id}`}>{invoice.sales_customer_snapshot?.displayName ?? "—"}</Link> },
            { label: "Invoice date", value: calendarDate(invoice.invoice_date) },
            { label: "Payment terms", value: invoice.paymentTerm?.name ?? "—" },
            { label: "Due date", value: invoice.dueDateRequired ? "To be entered" : calendarDate(invoice.due_date) },
            { label: "Total", value: money(currency, invoice.grand_total) },
            ...(posted ? [{ label: "Balance due", value: money(currency, invoice.balanceDue) }] : []),
            { label: "Sales order", value: <Link className="hover:underline" href={`/sales/orders/${invoice.sales_order_id}`}>{invoice.sales_order_number}</Link> },
          ],
          primaryAction: actions.post ? (
            <Button variant="primary" onPress={() => setDialog("post")}><Check className="size-4" aria-hidden="true" />Post Invoice</Button>
          ) : actions.send ? (
            <Button variant="primary" onPress={() => setDialog("send")}><Send className="size-4" aria-hidden="true" />Send Invoice</Button>
          ) : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <Button variant="secondary" onPress={() => setDialog("edit")}><Pencil className="size-4" aria-hidden="true" />Edit</Button>}
              {!actions.edit && (actions.changePaymentTerms || actions.overrideDueDate) && <Button variant="secondary" onPress={() => setDialog("terms")}>Payment Terms / Due Date</Button>}
              {actions.print && <a className={buttonVariants({ variant: "secondary" })} href={invoicePdfUrl(invoiceId, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />{posted ? "View PDF" : "Draft PDF"}</a>}
              {actions.print && posted && <LinkButton variant="secondary" href={invoicePdfUrl(invoiceId)} download>Download</LinkButton>}
              {actions.markSent && <Button variant="secondary" onPress={() => setDialog("markSent")}>Mark as Sent</Button>}
              {actions.recordPayment && <LinkButton variant="secondary" href="/accounting/receipts"><Wallet className="size-4" aria-hidden="true" />Record Payment</LinkButton>}
              {actions.creditNote && <Button variant="secondary" onPress={() => setDialog("credit")}><FileMinus className="size-4" aria-hidden="true" />Create Credit Note</Button>}
              {actions.changeDueDate && <Button variant="ghost" onPress={() => setDialog("dueDate")}>Change Due Date</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Draft</Button>}
              {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse</Button>}
            </div>
          ),
        }}
      >
        <MetricStrip
          metrics={[
            { label: "Taxable value", value: money(currency, Number(invoice.subtotal) - Number(invoice.discount_total)) },
            { label: "Tax", value: money(currency, invoice.tax_total) },
            { label: "Grand total", value: money(currency, invoice.grand_total) },
            ...(posted && invoice.amountPaid !== null ? [{ label: "Paid", value: money(currency, invoice.amountPaid) }] : []),
            ...(posted && invoice.creditedTotal ? [{ label: "Credit notes", value: money(currency, invoice.creditedTotal) }, { label: "Net after credits", value: money(currency, invoice.netAfterCredits) }] : []),
            ...(posted ? [{ label: "Balance due", value: money(currency, invoice.balanceDue) }] : []),
          ]}
        />
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Invoice sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items ({detail.lines.length})</Tab>
            <Tab id="taxes">Taxes</Tab>
            {actions.viewPayments && <Tab id="payments">Payments</Tab>}
            <Tab id="credits">Credits</Tab>
            <Tab id="related">Related documents</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            {actions.viewAccounting && <Tab id="accounting">Accounting</Tab>}
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><Overview detail={detail} /></TabPanel>
          <TabPanel id="items"><Items detail={detail} /></TabPanel>
          <TabPanel id="taxes"><Taxes detail={detail} /></TabPanel>
          {actions.viewPayments && <TabPanel id="payments"><Payments detail={detail} /></TabPanel>}
          <TabPanel id="credits"><Credits detail={detail} onCredit={actions.creditNote ? () => setDialog("credit") : undefined} /></TabPanel>
          <TabPanel id="related"><Related detail={detail} /></TabPanel>
          <TabPanel id="notes"><Notes detail={detail} canEdit={actions.edit || actions.send} onChanged={refresh} /></TabPanel>
          {actions.viewAccounting && <TabPanel id="accounting"><Accounting detail={detail} /></TabPanel>}
          <TabPanel id="history"><History detail={detail} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "edit" && <EditInvoiceDialog detail={detail} canChangeDates={canChangeDates} onClose={() => setDialog(null)} onDone={() => done("The draft was saved.")} />}
      {dialog === "terms" && <EditInvoiceDialog detail={detail} canChangeDates={false} termsOnly onClose={() => setDialog(null)} onDone={() => done("The payment terms and due date were saved.")} />}
      {dialog === "post" && <PostInvoiceDialog detail={detail} onClose={() => setDialog(null)} onDone={(message) => done(message)} />}
      {dialog === "cancel" && <CancelInvoiceDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was cancelled.")} />}
      {dialog === "reverse" && <ReverseInvoiceDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The invoice was reversed.")} />}
      {dialog === "send" && <SendInvoiceDialog detail={detail} onClose={() => setDialog(null)} onDone={(sentTo) => done(`The invoice was sent to ${sentTo}.`)} />}
      {dialog === "dueDate" && <ChangeDueDateDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The due date was changed.")} />}
      {dialog === "markSent" && <MarkSentDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The invoice is marked as sent.")} />}
      {dialog === "credit" && <CreateCreditNoteDialog invoiceId={invoice.id} onClose={() => setDialog(null)} onDone={(creditNoteId) => router.push(`/sales/credit-notes/${creditNoteId}`)} />}
    </div>
  );
}

function Overview({ detail }: { detail: InvoiceDetail }) {
  const invoice = detail.invoice;
  const customer = invoice.sales_customer_snapshot;
  const seller = invoice.seller_snapshot;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Customer" description="As invoiced: later changes to the customer do not change this invoice.">
        <Facts items={[
          { label: "Customer", value: customer?.legalName ?? customer?.displayName ?? "—" },
          { label: "Customer number", value: customer?.customerNumber ?? invoice.customer_number ?? "—" },
          { label: "GSTIN", value: customer?.gstin ?? "—" },
          { label: "Contact", value: [personName(invoice.contact_snapshot), invoice.contact_snapshot?.email, invoice.contact_snapshot?.phone].filter(Boolean).join(" · ") || "—" },
          { label: "Bill to", value: <span className="whitespace-pre-line">{addressText(invoice.billing_address_snapshot)}</span> },
          { label: "Ship to", value: <span className="whitespace-pre-line">{addressText(invoice.shipping_address_snapshot)}</span> },
        ]} />
      </Panel>
      <Panel title="Invoice">
        <Facts items={[
          { label: "Invoice date", value: calendarDate(invoice.invoice_date) },
          { label: "Posting date", value: calendarDate(invoice.accounting_date) },
          { label: "Payment terms", value: invoice.paymentTerm
            ? <span className="flex flex-col"><span>{invoice.paymentTerm.name}</span><span className="text-xs text-text-muted">{invoice.paymentTerm.summary}</span>
                {[invoice.paymentTerm.description, invoice.paymentTerm.note].filter(Boolean).map((line, index) => <span key={index} className="text-xs text-text-muted">{line}</span>)}</span>
            : "—" },
          { label: "Due date", value: invoice.dueDateRequired ? "To be entered before posting"
            : <span className="flex flex-col"><span>{calendarDate(invoice.due_date)}</span>
                {invoice.due_date_overridden && invoice.paymentTerm?.calculationType !== "custom" && (
                  <span className="text-xs text-text-muted">Set by hand{invoice.due_date_override_reason ? `: ${invoice.due_date_override_reason}` : ""}{invoice.calculated_due_date ? ` · the terms work out ${calendarDate(invoice.calculated_due_date)}` : ""}</span>
                )}</span> },
          { label: "Currency", value: invoice.currency_code },
          { label: "Customer PO", value: invoice.customer_po_number ?? "—" },
          { label: "Invoiced on", value: invoice.quantity_basis === "delivered" ? "Delivered quantities" : "Ordered quantities" },
          { label: "Salesperson", value: invoice.owner_name ?? "—" },
          { label: "Sent", value: invoice.sent ? `${dateTime(invoice.sent_at)}${invoice.sent_to ? ` to ${invoice.sent_to}` : ""}` : "Not sent" },
        ]} />
      </Panel>
      <Panel title="Tax">
        <Facts items={[
          { label: "Issued by", value: seller?.name ? `${seller.legalName ?? seller.name}${seller.gstin ? ` · GSTIN ${seller.gstin}` : ""}` : "—" },
          { label: "Place of supply", value: invoice.place_of_supply ? `${invoice.place_of_supply_name ?? ""} (${invoice.place_of_supply})`.trim() : "—" },
          { label: "GST", value: ({ intra_state: "Within the state: CGST + SGST", inter_state: "Between states: IGST" } as Record<string, string>)[invoice.supply_nature ?? ""] ?? "—" },
          { label: "e-Invoice", value: invoice.e_invoice_reference ? `IRN ${invoice.e_invoice_reference}` : statusLabel(invoice.e_invoice_status) },
        ]} />
      </Panel>
      <Panel title="Status history">
        <Facts items={[
          { label: "Created", value: by(invoice.created_at, invoice.created_by_name) },
          { label: "Posted", value: by(invoice.posted_at, invoice.posted_by_name) },
          { label: "Reversed", value: by(invoice.reversed_at, invoice.reversed_by_name) },
        ]} />
      </Panel>
    </div>
  );
}

function Items({ detail }: { detail: InvoiceDetail }) {
  const currency = detail.invoice.currency_code;
  const columns: ColumnDef<InvoiceLine, unknown>[] = [
    { id: "seq", header: "#", cell: ({ row }) => row.original.sequence },
    {
      id: "item", header: "Product / service",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className="font-medium">{row.original.item_name_snapshot}</span>
          <span className="text-xs text-text-muted">{[row.original.item_code_snapshot, row.original.hsn_sac_code && `${row.original.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${row.original.hsn_sac_code}`,
            row.original.delivery_number && `Delivery ${row.original.delivery_number}`].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { id: "qty", header: "Quantity", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{quantity(row.original.quantity)} {row.original.uom_snapshot ?? ""}</span> },
    { id: "price", header: "Unit price", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(currency, row.original.unit_price)}</span> },
    { id: "discount", header: "Discount", cell: ({ row }) => <span className="tabular-nums">{Number(row.original.discount_amount) ? money(currency, row.original.discount_amount) : ""}</span> },
    { id: "taxable", header: "Taxable", cell: ({ row }) => <span className="tabular-nums">{money(currency, row.original.net_amount)}</span> },
    {
      id: "tax", header: "Tax",
      cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.taxes.map((tax) => `${TAX_LABELS[tax.tax_type] ?? tax.label} ${Number(tax.rate)}%`).join(" + ") || "No tax"}</span>,
    },
    { id: "total", header: "Amount", cell: ({ row }) => <span className="font-medium tabular-nums">{money(currency, row.original.line_total)}</span> },
  ];
  return (
    <div className="pt-4">
      <EnterpriseDataGrid<InvoiceLine> aria-label="Invoice items" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready"
        renderMobileCard={(line) => (
          <div className="flex flex-col gap-1"><span className="font-medium">{line.item_name_snapshot}</span><span className="text-sm tabular-nums">{quantity(line.quantity)} · {money(currency, line.line_total)}</span></div>
        )} />
    </div>
  );
}

function Taxes({ detail }: { detail: InvoiceDetail }) {
  const invoice = detail.invoice;
  const currency = invoice.currency_code;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Tax by component" description="Worked out by the central tax engine for each line, from its tax category, the seller's registration and the place of supply.">
        {!detail.taxSummary.length ? <p className="text-sm text-text-muted">No tax is charged on this invoice.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr className="border-b border-border"><th className="py-2 pr-3 font-medium">Tax</th><th className="py-2 pr-3 text-right font-medium">Taxable value</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
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
      </Panel>
      <Panel title="Totals">
        <Facts columns={4} items={[
          { label: "Subtotal", value: money(currency, invoice.subtotal) },
          { label: "Discounts", value: money(currency, invoice.discount_total) },
          { label: "Taxable value", value: money(currency, Number(invoice.subtotal) - Number(invoice.discount_total)) },
          { label: "Tax", value: money(currency, invoice.tax_total) },
          { label: "Round off", value: money(currency, invoice.rounding_adjustment) },
          { label: "Grand total", value: money(currency, invoice.grand_total) },
        ]} />
      </Panel>
    </div>
  );
}

function Payments({ detail }: { detail: InvoiceDetail }) {
  const invoice = detail.invoice;
  const currency = invoice.currency_code;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Payments" description="Receipts are recorded and applied by Finance; the paid amount and balance follow from them.">
        <Facts items={[
          { label: "Invoice total", value: money(currency, invoice.grand_total) },
          { label: "Paid", value: money(currency, invoice.amountPaid ?? 0) },
          { label: "Balance due", value: money(currency, invoice.balanceDue) },
        ]} />
        {!detail.receipts.length ? <p className="text-sm text-text-muted">No payments yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.receipts.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium tabular-nums">{receipt.receipt_number}</span>
                <span className="tabular-nums">{money(currency, receipt.allocated_amount)}</span>
                <span className="text-text-muted">{calendarDate(receipt.receipt_date)}{receipt.payment_method ? ` · ${statusLabel(receipt.payment_method)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Credits({ detail, onCredit }: { detail: InvoiceDetail; onCredit?: () => void }) {
  const invoice = detail.invoice;
  const currency = invoice.currency_code;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Credit notes" description="A posted invoice is corrected by a credit note, never edited: its total stays as invoiced. Posting a credit note applies it to this invoice."
        actions={onCredit ? <Button variant="secondary" size="compact" onPress={onCredit}>Create Credit Note</Button> : undefined}>
        <Facts items={[
          { label: "Credit status", value: invoice.creditStatusLabel },
          { label: "Invoice total", value: money(currency, invoice.grand_total) },
          { label: "Credited (posted credit notes)", value: money(currency, invoice.creditedTotal) },
          { label: "Net after credits", value: money(currency, invoice.netAfterCredits) },
        ]} />
        {!detail.creditNotes.length ? <p className="text-sm text-text-muted">No credit notes.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.creditNotes.map((credit) => (
              <li key={credit.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link className="font-medium tabular-nums text-brand hover:underline" href={`/sales/credit-notes/${credit.id}`}>{credit.invoice_number}</Link>
                <StatusBadge tone={statusTone(credit.status)}>{credit.statusLabel}</StatusBadge>
                {Number(credit.refunded) > 0 && <span className="text-text-muted">refunded {money(credit.currency_code, credit.refunded)} from its credit</span>}
                <span className="text-text-muted">{calendarDate(credit.invoice_date)}</span>
                <span className="tabular-nums">{money(credit.currency_code, credit.grand_total)}</span>
              </li>
            ))}
          </ul>
        )}
        {detail.credits.length > 0 && (
          <p className="text-xs text-text-muted">Applied to this invoice: {detail.credits.map((credit) => `${credit.credit_note_number} ${money(currency, credit.allocated_amount)}`).join(", ")}</p>
        )}
      </Panel>
    </div>
  );
}

function Related({ detail }: { detail: InvoiceDetail }) {
  const invoice = detail.invoice;
  const link = (href: string, label: string) => <Link className="text-brand hover:underline" href={href}>{label}</Link>;
  return (
    <div className="pt-4">
      <Panel title="Related documents">
        <Facts items={[
          { label: "Opportunity", value: invoice.source_opportunity_id ? link(`/crm/opportunities/${invoice.source_opportunity_id}`, invoice.source_opportunity_name ?? "Opportunity") : "—" },
          { label: "Quotation", value: invoice.source_quotation_id ? link(`/sales/quotations/${invoice.source_quotation_id}`, invoice.source_quotation_number ?? "Quotation") : "—" },
          { label: "Sales order", value: link(`/sales/orders/${invoice.sales_order_id}`, invoice.sales_order_number) },
          { label: "Deliveries", value: detail.deliveries.length ? <span className="flex flex-wrap gap-2">{detail.deliveries.map((delivery) => <span key={delivery.id}>{link(`/sales/deliveries/${delivery.id}`, delivery.delivery_number)}</span>)}</span> : "—" },
          { label: "Returns", value: detail.returns.length ? <span className="flex flex-wrap gap-2">{detail.returns.map((item) => <Link key={item.id} className="text-brand hover:underline" href={`/sales/returns/${item.id}`}>{item.return_number}</Link>)}</span> : "None" },
          { label: "Credit notes", value: detail.creditNotes.length ? <span className="flex flex-wrap gap-2">{detail.creditNotes.map((credit) => <span key={credit.id}>{link(`/sales/credit-notes/${credit.id}`, credit.invoice_number)}</span>)}</span> : "—" },
          { label: "Receipts", value: detail.receipts.length ? detail.receipts.map((receipt) => receipt.receipt_number).join(", ") : "—" },
        ]} />
      </Panel>
    </div>
  );
}

function Notes({ detail, canEdit, onChanged }: { detail: InvoiceDetail; canEdit: boolean; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const invoice = detail.invoice;
  const filesKey = scopedQueryKey(workspace, "sales", "invoice", invoice.id, "files");
  const files = useQuery({ queryKey: filesKey, queryFn: () => listInvoiceFiles(invoice.id).then((r) => r.files) });
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const after = () => { setError(null); void queryClient.invalidateQueries({ queryKey: filesKey }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadInvoiceFile(invoice.id, file), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be uploaded.")) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeInvoiceFile(invoice.id, fileId), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be removed.")) });
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Customer notes" description="Printed on the invoice."><p className="text-sm whitespace-pre-line">{invoice.customer_notes ?? "None"}</p></Panel>
      <Panel title="Internal notes" description="Never printed or shown to the customer."><p className="text-sm whitespace-pre-line">{invoice.internal_notes ?? "None"}</p></Panel>
      {invoice.terms_and_conditions && <Panel title="Terms and conditions"><p className="text-sm whitespace-pre-line">{invoice.terms_and_conditions}</p></Panel>}
      <Panel title="Attachments" description="Files kept with the invoice, including each PDF that was emailed."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Upload</Button>
          </>
        ) : undefined}>
        {error && <Notice>{error}</Notice>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={invoiceFileUrl(invoice.id, file.id)}>{file.fileName}</a>
                <span className="text-text-muted">{dateTime(file.uploadedAt)}</span>
                {canEdit && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Accounting({ detail }: { detail: InvoiceDetail }) {
  const invoice = detail.invoice;
  return (
    <div className="pt-4">
      <Panel title="Accounting" description="Posting debits the customer's receivable and credits revenue and output tax.">
        <Facts items={[
          { label: "Journal entry", value: invoice.journal_entry_number ? <Link className="text-brand hover:underline" href="/accounting/journals">{invoice.journal_entry_number}</Link> : "Not posted yet" },
          { label: "Posting date", value: calendarDate(invoice.accounting_date) },
          { label: "Finance status", value: statusLabel(invoice.financeStatus) },
        ]} />
      </Panel>
    </div>
  );
}

function History({ detail }: { detail: InvoiceDetail }) {
  return (
    <div className="pt-4">
      <Panel title="History">
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
      </Panel>
    </div>
  );
}

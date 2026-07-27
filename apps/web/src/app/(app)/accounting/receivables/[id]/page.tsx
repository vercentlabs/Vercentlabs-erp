import { notFound } from "next/navigation";
import { getCustomerInvoice } from "@vercentlabs/api";
import AccountingActionButton from "@/components/accounting/accounting-action-button";
import CreditAllocationForm from "@/components/accounting/credit-allocation-form";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { accountingContext } from "@/lib/accounting";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type Detail = {
  invoice: Row;
  lines: Row[];
  schedules: Row[];
  allocations: Row[];
  creditAllocations: Row[];
  creditCandidates: Row[];
  events: Row[];
};

export default async function ReceivableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) return notFound();
  const context = accountingContext(session);
  let data: Detail;
  try {
    data = await tenantTransaction(context.organizationId, (client) => getCustomerInvoice(client, context, id)) as unknown as Detail;
  } catch {
    return notFound();
  }
  const invoice = data.invoice;
  const isCreditNote = String(invoice.invoice_type) === "credit_note";
  const canAllocate = isCreditNote
    && ["posted", "partially_paid"].includes(String(invoice.status))
    && Number(invoice.outstanding_amount || 0) > 0
    && hasPermission(session, PERMISSIONS.accountingReceiptsManage);
  const candidates = data.creditCandidates.map((row) => ({
    id: String(row.id),
    documentNumber: String(row.invoice_number),
    dueDate: String(row.due_date),
    currencyCode: String(row.currency_code),
    outstandingAmount: String(row.outstanding_amount),
  }));

  return <>
    <section className="page-heading">
      <div>
        <p className="eyebrow">{isCreditNote ? "Customer credit note" : "Customer invoice"}</p>
        <h1>{String(invoice.invoice_number)}</h1>
        <p>{String(invoice.customer_name)} · Due {String(invoice.due_date).slice(0, 10)}</p>
      </div>
      <span className="status-badge neutral">{String(invoice.status)}</span>
    </section>
    <div className="accounting-action-bar">
      {String(invoice.status) === "draft" && hasPermission(session, PERMISSIONS.accountingReceivablesManage)
        ? <AccountingActionButton endpoint={`/api/accounting/receivables/invoices/${id}/actions`} action="submit" label="Submit for approval" tone="secondary" /> : null}
      {String(invoice.status) === "approved" && hasPermission(session, PERMISSIONS.accountingReceivablesManage)
        ? <AccountingActionButton endpoint={`/api/accounting/receivables/invoices/${id}/actions`} action="post" label={isCreditNote ? "Post credit note" : "Post invoice"} tone="primary" /> : null}
    </div>
    <div className="accounting-two-column">
      <section className="panel">
        <p className="eyebrow">Document lines</p>
        <h2>Revenue and tax detail</h2>
        <div className="accounting-table accounting-invoice-detail">
          <div className="accounting-table-row accounting-table-head"><span>Description</span><span>Quantity</span><span>Revenue account</span><span>Net</span><span>Tax</span><span>Total</span></div>
          {data.lines.map((line) => <div className="accounting-table-row" key={String(line.id)}>
            <span>{String(line.description)}</span><span>{String(line.quantity)}</span>
            <span>{String(line.revenue_account_code)} · {String(line.revenue_account_name)}</span>
            <span>{String(invoice.currency_code)} {String(line.net_amount)}</span>
            <span>{String(invoice.currency_code)} {String(line.tax_amount)}</span>
            <span>{String(invoice.currency_code)} {String(line.line_total)}</span>
          </div>)}
        </div>
      </section>
      <aside className="panel accounting-summary">
        <p className="eyebrow">Financial position</p>
        <dl>
          <div><dt>Subtotal</dt><dd>{String(invoice.currency_code)} {String(invoice.subtotal)}</dd></div>
          <div><dt>Discount</dt><dd>{String(invoice.currency_code)} {String(invoice.discount_total)}</dd></div>
          <div><dt>Tax</dt><dd>{String(invoice.currency_code)} {String(invoice.tax_total)}</dd></div>
          <div><dt>Grand total</dt><dd><strong>{String(invoice.currency_code)} {String(invoice.grand_total)}</strong></dd></div>
          <div><dt>{isCreditNote ? "Unapplied credit" : "Outstanding"}</dt><dd><strong>{String(invoice.currency_code)} {String(invoice.outstanding_amount)}</strong></dd></div>
        </dl>
      </aside>
    </div>
    {canAllocate ? <section className="panel">
      <p className="eyebrow">Credit application</p><h2>Apply credit to an open customer invoice</h2>
      <CreditAllocationForm endpoint={`/api/accounting/receivables/invoices/${id}/actions`} kind="receivable" creditBalance={String(invoice.outstanding_amount)} candidates={candidates} />
    </section> : null}
    <div className="accounting-two-column">
      <section className="panel">
        <p className="eyebrow">Payment schedule</p><h2>Due amounts</h2>
        <div className="accounting-list">{data.schedules.map((row) => <div key={String(row.id)}><span><strong>Installment {String(row.sequence)}</strong><small>Due {String(row.due_date).slice(0, 10)}</small></span><b>{String(invoice.currency_code)} {String(row.outstanding_amount)}</b></div>)}</div>
      </section>
      <section className="panel">
        <p className="eyebrow">Credit applications</p><h2>Applied credits</h2>
        <div className="accounting-list">{data.creditAllocations.map((row) => <div key={String(row.id)}><span><strong>{String(row.credit_note_number)} → {String(row.target_invoice_number)}</strong><small>{new Date(String(row.allocated_at)).toLocaleString("en-IN")}</small></span><b>{String(invoice.currency_code)} {String(row.allocated_amount)}</b></div>)}{!data.creditAllocations.length ? <p>No credit applications recorded.</p> : null}</div>
      </section>
    </div>
    <section className="panel">
      <p className="eyebrow">Audit history</p><h2>Document events</h2>
      <div className="accounting-list">{data.events.map((row) => <div key={String(row.id)}><span><strong>{String(row.event_type)}</strong><small>{String(row.from_status || "Created")} → {String(row.to_status || row.from_status || "Recorded")}</small></span><time>{new Date(String(row.occurred_at)).toLocaleString("en-IN")}</time></div>)}</div>
    </section>
  </>;
}

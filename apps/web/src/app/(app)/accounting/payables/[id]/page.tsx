import { notFound } from "next/navigation";
import { getVendorBill, getVendorBillMatch } from "@vercentlabs/api";
import AccountingActionButton from "@/components/accounting/accounting-action-button";
import CreditAllocationForm from "@/components/accounting/credit-allocation-form";
import VendorMatchForm from "@/components/accounting/vendor-match-form";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { accountingContext } from "@/lib/accounting";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type Detail = {
  bill: Row;
  lines: Row[];
  schedules: Row[];
  allocations: Row[];
  creditAllocations: Row[];
  creditCandidates: Row[];
  events: Row[];
  match: Row | null;
};

export default async function PayableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) return notFound();
  const context = accountingContext(session);
  let data: Detail;
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const detail = await getVendorBill(client, context, id) as unknown as Omit<Detail, "match">;
      const match = await getVendorBillMatch(client, context, id) as Row | null;
      return { ...detail, match };
    }) as unknown as Detail;
  } catch {
    return notFound();
  }
  const bill = data.bill;
  const isCreditNote = String(bill.bill_type) === "credit_note";
  const canAllocate = isCreditNote
    && ["posted", "partially_paid"].includes(String(bill.status))
    && Number(bill.outstanding_amount || 0) > 0
    && hasPermission(session, PERMISSIONS.accountingPaymentsManage);
  const candidates = data.creditCandidates.map((row) => ({
    id: String(row.id), documentNumber: String(row.bill_number), dueDate: String(row.due_date),
    currencyCode: String(row.currency_code), outstandingAmount: String(row.outstanding_amount),
  }));

  return <>
    <section className="page-heading">
      <div><p className="eyebrow">{isCreditNote ? "Vendor credit note" : "Vendor bill"}</p><h1>{String(bill.bill_number)}</h1><p>{String(bill.supplier_name)} · Vendor reference {String(bill.supplier_invoice_number || "—")}</p></div>
      <span className="status-badge neutral">{String(bill.status)}</span>
    </section>
    <div className="accounting-action-bar">
      {String(bill.status) === "draft" && hasPermission(session, PERMISSIONS.accountingPayablesManage)
        ? <AccountingActionButton endpoint={`/api/accounting/payables/bills/${id}/actions`} action="submit" label="Submit for approval" tone="secondary" /> : null}
      {String(bill.status) === "approved" && hasPermission(session, PERMISSIONS.accountingPayablesManage)
        ? <AccountingActionButton endpoint={`/api/accounting/payables/bills/${id}/actions`} action="post" label={isCreditNote ? "Post vendor credit" : "Post vendor bill"} tone="primary" /> : null}
    </div>
    <div className="accounting-two-column">
      <section className="panel"><p className="eyebrow">Document lines</p><h2>Expense and input-tax detail</h2><div className="accounting-table accounting-invoice-detail"><div className="accounting-table-row accounting-table-head"><span>Description</span><span>Quantity</span><span>Expense account</span><span>Net</span><span>Tax</span><span>Total</span></div>{data.lines.map((line) => <div className="accounting-table-row" key={String(line.id)}><span>{String(line.description)}</span><span>{String(line.quantity)}</span><span>{String(line.expense_account_code)} · {String(line.expense_account_name)}</span><span>{String(bill.currency_code)} {String(line.net_amount)}</span><span>{String(bill.currency_code)} {String(line.tax_amount)}</span><span>{String(bill.currency_code)} {String(line.line_total)}</span></div>)}</div></section>
      <aside className="panel accounting-summary"><p className="eyebrow">Financial position</p><dl><div><dt>Subtotal</dt><dd>{String(bill.currency_code)} {String(bill.subtotal)}</dd></div><div><dt>Discount</dt><dd>{String(bill.currency_code)} {String(bill.discount_total)}</dd></div><div><dt>Tax</dt><dd>{String(bill.currency_code)} {String(bill.tax_total)}</dd></div><div><dt>Grand total</dt><dd><strong>{String(bill.currency_code)} {String(bill.grand_total)}</strong></dd></div><div><dt>{isCreditNote ? "Unapplied credit" : "Outstanding"}</dt><dd><strong>{String(bill.currency_code)} {String(bill.outstanding_amount)}</strong></dd></div></dl></aside>
    </div>
    {canAllocate ? <section className="panel"><p className="eyebrow">Credit application</p><h2>Apply credit to an open vendor bill</h2><CreditAllocationForm endpoint={`/api/accounting/payables/bills/${id}/actions`} kind="payable" creditBalance={String(bill.outstanding_amount)} candidates={candidates} /></section> : null}
    {!isCreditNote && ["draft", "approved"].includes(String(bill.status)) && hasPermission(session, PERMISSIONS.accountingPayablesManage) ? <VendorMatchForm endpoint={`/api/accounting/payables/bills/${id}/matching`} currentStatus={String(data.match?.status || bill.matching_status || "not_required")} billTotal={String(bill.grand_total)} canOverride={hasPermission(session, PERMISSIONS.accountingJournalApprove)} /> : null}
    <div className="accounting-two-column">
      <section className="panel"><p className="eyebrow">Payment schedule</p><h2>Due amounts</h2><div className="accounting-list">{data.schedules.map((row) => <div key={String(row.id)}><span><strong>Installment {String(row.sequence)}</strong><small>Due {String(row.due_date).slice(0, 10)}</small></span><b>{String(bill.currency_code)} {String(row.outstanding_amount)}</b></div>)}</div></section>
      <section className="panel"><p className="eyebrow">Credit applications</p><h2>Applied credits</h2><div className="accounting-list">{data.creditAllocations.map((row) => <div key={String(row.id)}><span><strong>{String(row.credit_note_number)} → {String(row.target_bill_number)}</strong><small>{new Date(String(row.allocated_at)).toLocaleString("en-IN")}</small></span><b>{String(bill.currency_code)} {String(row.allocated_amount)}</b></div>)}{!data.creditAllocations.length ? <p>No credit applications recorded.</p> : null}</div></section>
    </div>
    <section className="panel"><p className="eyebrow">Audit history</p><h2>Document events</h2><div className="accounting-list">{data.events.map((row) => <div key={String(row.id)}><span><strong>{String(row.event_type)}</strong><small>{String(row.from_status || "Created")} → {String(row.to_status || row.from_status || "Recorded")}</small></span><time>{new Date(String(row.occurred_at)).toLocaleString("en-IN")}</time></div>)}</div></section>
  </>;
}

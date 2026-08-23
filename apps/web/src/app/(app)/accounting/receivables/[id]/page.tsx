import {
  assessCustomerInvoiceReadiness,
  getCustomerInvoice,
  getCustomerInvoiceGovernanceTimeline,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";

import AccountingActionButton from "@/modules/accounting/components/accounting-action-button";
import CreditAllocationForm from "@/modules/accounting/components/credit-allocation-form";
import { accountingContext } from "@/modules/accounting";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";

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
type Governance = {
  invoice: Row;
  health: {
    readiness?: string;
    blockers?: string[];
    warnings?: string[];
    riskBand?: string;
    collectionRequired?: boolean;
    metrics?: Record<string, unknown>;
  };
};

export default async function ReceivableDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) return notFound();
  const context = accountingContext(session);
  let data: Detail;
  let governance: Governance;
  let timeline: Row[];
  try {
    ({ data, governance, timeline } = await tenantTransaction(
      context.organizationId,
      async (client) => ({
        data: (await getCustomerInvoice(
          client,
          context,
          id,
        )) as unknown as Detail,
        governance: (await assessCustomerInvoiceReadiness(
          client,
          context,
          id,
        )) as unknown as Governance,
        timeline: (await getCustomerInvoiceGovernanceTimeline(
          client,
          context,
          id,
        )) as unknown as Row[],
      }),
    ));
  } catch {
    return notFound();
  }
  const invoice = data.invoice;
  const health = governance.health;
  const governedInvoice = governance.invoice;
  const isCreditNote = String(invoice.invoice_type) === "credit_note";
  const canAllocate =
    isCreditNote &&
    ["posted", "partially_paid"].includes(String(invoice.status)) &&
    Number(invoice.outstanding_amount || 0) > 0 &&
    hasPermission(session, PERMISSIONS.accountingReceiptsManage);
  const candidates = data.creditCandidates.map((row) => ({
    id: String(row.id),
    documentNumber: String(row.invoice_number),
    dueDate: String(row.due_date),
    currencyCode: String(row.currency_code),
    outstandingAmount: String(row.outstanding_amount),
  }));
  const governanceMessages = [
    ...(health.blockers || []),
    ...(health.warnings || []),
  ];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">
            {isCreditNote ? "Customer credit note" : "Customer invoice"}
          </p>
          <h1>{String(invoice.invoice_number)}</h1>
          <p>
            {String(invoice.customer_name)} · Due{" "}
            {String(invoice.due_date).slice(0, 10)}
          </p>
        </div>
        <span className="status-badge neutral">{String(invoice.status)}</span>
      </section>

      <div className="accounting-action-bar">
        {String(invoice.status) === "draft" &&
        hasPermission(session, PERMISSIONS.accountingReceivablesManage) ? (
          <AccountingActionButton
            endpoint={`/api/accounting/receivables/invoices/${id}/actions`}
            action="submit"
            label="Submit for approval"
            tone="secondary"
          />
        ) : null}
        {String(invoice.status) === "approved" &&
        hasPermission(session, PERMISSIONS.accountingReceivablesManage) ? (
          <AccountingActionButton
            endpoint={`/api/accounting/receivables/invoices/${id}/actions`}
            action="post"
            label={isCreditNote ? "Post credit note" : "Post invoice"}
            tone="primary"
          />
        ) : null}
      </div>

      <section className="panel">
        <p className="eyebrow">Receivables governance</p>
        <h2>Posting, schedule and collection readiness</h2>
        <section className="accounting-capability-grid">
          {[
            ["Readiness", health.readiness || "unknown"],
            ["Risk", health.riskBand || "unknown"],
            [
              "Collection",
              health.collectionRequired ? "required" : "not required",
            ],
            [
              "Case status",
              governedInvoice.collection_case_status || "not opened",
            ],
          ].map(([label, value]) => (
            <article key={String(label)}>
              <strong>{String(value)}</strong>
              <span>{String(label)}</span>
            </article>
          ))}
        </section>
        {governanceMessages.length ? (
          <div className="accounting-list">
            {governanceMessages.map((message) => (
              <div key={message}>
                <span>{message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>No governance blockers or warnings are active.</p>
        )}
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Document lines</p>
          <h2>Revenue and tax detail</h2>
          <div className="accounting-table accounting-invoice-detail">
            <div className="accounting-table-row accounting-table-head">
              <span>Description</span>
              <span>Quantity</span>
              <span>Revenue account</span>
              <span>Net</span>
              <span>Tax</span>
              <span>Total</span>
            </div>
            {data.lines.map((line) => (
              <div className="accounting-table-row" key={String(line.id)}>
                <span>{String(line.description)}</span>
                <span>{String(line.quantity)}</span>
                <span>
                  {String(line.revenue_account_code)} ·{" "}
                  {String(line.revenue_account_name)}
                </span>
                <span>
                  {String(invoice.currency_code)} {String(line.net_amount)}
                </span>
                <span>
                  {String(invoice.currency_code)} {String(line.tax_amount)}
                </span>
                <span>
                  {String(invoice.currency_code)} {String(line.line_total)}
                </span>
              </div>
            ))}
          </div>
        </section>
        <aside className="panel accounting-summary">
          <p className="eyebrow">Financial position</p>
          <dl>
            <div>
              <dt>Subtotal</dt>
              <dd>
                {String(invoice.currency_code)} {String(invoice.subtotal)}
              </dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>
                {String(invoice.currency_code)} {String(invoice.discount_total)}
              </dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>
                {String(invoice.currency_code)} {String(invoice.tax_total)}
              </dd>
            </div>
            <div>
              <dt>Grand total</dt>
              <dd>
                <strong>
                  {String(invoice.currency_code)} {String(invoice.grand_total)}
                </strong>
              </dd>
            </div>
            <div>
              <dt>{isCreditNote ? "Unapplied credit" : "Outstanding"}</dt>
              <dd>
                <strong>
                  {String(invoice.currency_code)}{" "}
                  {String(invoice.outstanding_amount)}
                </strong>
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {canAllocate ? (
        <section className="panel">
          <p className="eyebrow">Credit application</p>
          <h2>Apply credit to an open customer invoice</h2>
          <CreditAllocationForm
            endpoint={`/api/accounting/receivables/invoices/${id}/actions`}
            kind="receivable"
            creditBalance={String(invoice.outstanding_amount)}
            candidates={candidates}
          />
        </section>
      ) : null}

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Payment schedule</p>
          <h2>Due amounts</h2>
          <div className="accounting-list">
            {data.schedules.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>Installment {String(row.sequence)}</strong>
                  <small>Due {String(row.due_date).slice(0, 10)}</small>
                </span>
                <b>
                  {String(invoice.currency_code)}{" "}
                  {String(row.outstanding_amount)}
                </b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Credit applications</p>
          <h2>Applied credits</h2>
          <div className="accounting-list">
            {data.creditAllocations.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.credit_note_number)} →{" "}
                    {String(row.target_invoice_number)}
                  </strong>
                  <small>
                    {new Date(String(row.allocated_at)).toLocaleString("en-IN")}
                  </small>
                </span>
                <b>
                  {String(invoice.currency_code)} {String(row.allocated_amount)}
                </b>
              </div>
            ))}
            {!data.creditAllocations.length ? (
              <p>No credit applications recorded.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">Receivable timeline</p>
        <h2>Accounting and collection history</h2>
        <div className="accounting-list">
          {timeline.map((row) => (
            <div key={`${String(row.kind)}-${String(row.id)}`}>
              <span>
                <strong>{String(row.kind)}</strong>
                <small>
                  {String(row.from_status || "Recorded")} →{" "}
                  {String(row.to_status || "Recorded")}
                </small>
              </span>
              <time>
                {new Date(String(row.happened_at)).toLocaleString("en-IN")}
              </time>
            </div>
          ))}
          {!timeline.length ? <p>No receivables events recorded.</p> : null}
        </div>
      </section>
    </>
  );
}

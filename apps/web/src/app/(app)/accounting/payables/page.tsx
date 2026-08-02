import { getPayablesGovernanceDashboard } from "@vercentlabs/api";
import Link from "next/link";

import { accountingContext } from "@/lib/accounting";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

type Dashboard = {
  summary: Record<string, unknown>;
  bills: Row[];
  exceptionCases: Row[];
  paymentProposals: Row[];
  importQueue: Row[];
  topSuppliers: Row[];
};

export default async function PayablesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) {
    return (
      <section className="panel">
        <h1>Accounting access required</h1>
      </section>
    );
  }
  const context = accountingContext(session);
  const dashboard = (await tenantTransaction(context.organizationId, (client) =>
    getPayablesGovernanceDashboard(client, context),
  )) as unknown as Dashboard;
  const summaryCards: Array<[string, unknown]> = [
    ["Open bills", dashboard.summary.open],
    ["Overdue", dashboard.summary.overdue],
    ["Due soon", dashboard.summary.dueSoon],
    ["Payment eligible", dashboard.summary.paymentEligible],
    ["Matching exceptions", dashboard.summary.matchingExceptions],
  ];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Accounts payable</p>
          <h1>Vendor bills and payment governance</h1>
          <p>
            Govern supplier liabilities, matching exceptions, due-date risk,
            payment proposals, credits and Procurement-to-Accounting handoffs.
          </p>
        </div>
        {hasPermission(session, PERMISSIONS.accountingPayablesManage) ? (
          <Link className="primary-button" href="/accounting/payables/new">
            New vendor bill
          </Link>
        ) : null}
      </section>

      <section className="accounting-capability-grid">
        {summaryCards.map(([label, value]) => (
          <article key={label}>
            <strong>{String(value ?? 0)}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Exception queue</p>
          <h2>Matching and supplier issues</h2>
          <div className="accounting-list">
            {dashboard.exceptionCases.slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.bill_number)} · {String(row.supplier_name)}
                  </strong>
                  <small>
                    {String(row.priority)} priority · {String(row.reason_code)}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))}
            {!dashboard.exceptionCases.length ? (
              <p>No active payables exception cases.</p>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Payment proposals</p>
          <h2>Controlled cash outflow preparation</h2>
          <div className="accounting-list">
            {dashboard.paymentProposals.slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.proposal_code)}</strong>
                  <small>
                    {String(row.company_name)} · Pay{" "}
                    {String(row.payment_date).slice(0, 10)}
                  </small>
                </span>
                <b>
                  {String(row.currency_code)} {String(row.total_amount)} ·{" "}
                  {String(row.status)}
                </b>
              </div>
            ))}
            {!dashboard.paymentProposals.length ? (
              <p>No payment proposals have been created.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">Procurement handoff</p>
        <h2>Matched invoices waiting for vendor-bill import</h2>
        <div className="accounting-list">
          {dashboard.importQueue.slice(0, 8).map((row) => (
            <div key={String(row.id)}>
              <span>
                <strong>
                  {String(row.purchase_order_number || row.purchase_order_id)}
                </strong>
                <small>
                  {String(row.supplier_name || "Supplier")} ·{" "}
                  {String(
                    row.supplier_invoice_number || "No invoice reference",
                  )}
                </small>
              </span>
              <b>{String(row.status)}</b>
            </div>
          ))}
          {!dashboard.importQueue.length ? (
            <p>No matched Procurement invoices are waiting for import.</p>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Bill</span>
            <span>Vendor</span>
            <span>Due date</span>
            <span>Status</span>
            <span>Governance</span>
            <span>Outstanding</span>
          </div>
          {dashboard.bills.map((row) => {
            const health = (row.health || {}) as Record<string, unknown>;
            return (
              <Link
                className="accounting-table-row"
                href={`/accounting/payables/${String(row.id)}`}
                key={String(row.id)}
              >
                <span>
                  <strong>{String(row.bill_number)}</strong>
                  <small>
                    {String(row.supplier_invoice_number || row.bill_type)}
                  </small>
                </span>
                <span>{String(row.supplier_name)}</span>
                <span>{String(row.due_date).slice(0, 10)}</span>
                <span className="status-badge neutral">
                  {String(row.status)}
                </span>
                <span>{String(health.readiness || "unknown")}</span>
                <span>
                  {String(row.currency_code)} {String(row.outstanding_amount)}
                </span>
              </Link>
            );
          })}
          {!dashboard.bills.length ? <p>No vendor bills exist yet.</p> : null}
        </div>
      </section>
    </>
  );
}

import { getReceivablesGovernanceDashboard } from "@vercentlabs/api";
import Link from "next/link";

import { accountingContext } from "@/lib/accounting";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

type Dashboard = {
  summary: Record<string, unknown>;
  invoices: Row[];
  collectionCases: Row[];
  importQueue: Row[];
  topCustomers: Row[];
};

export default async function ReceivablesPage() {
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
    getReceivablesGovernanceDashboard(client, context),
  )) as unknown as Dashboard;
  const summaryCards: Array<[string, unknown]> = [
    ["Open invoices", dashboard.summary.open],
    ["Overdue", dashboard.summary.overdue],
    ["Due soon", dashboard.summary.dueSoon],
    ["Collections required", dashboard.summary.collectionRequired],
    ["Disputed", dashboard.summary.disputed],
  ];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Accounts receivable</p>
          <h1>Customer invoices and collections</h1>
          <p>
            Govern invoice readiness, outstanding balances, payment schedules,
            collection ownership, disputes and Sales-to-Accounting handoffs.
          </p>
        </div>
        {hasPermission(session, PERMISSIONS.accountingReceivablesManage) ? (
          <Link className="primary-button" href="/accounting/receivables/new">
            New invoice
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
          <p className="eyebrow">Collection queue</p>
          <h2>Active recovery work</h2>
          <div className="accounting-list">
            {dashboard.collectionCases.slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.invoice_number)} · {String(row.customer_name)}
                  </strong>
                  <small>
                    {String(row.priority)} priority · {String(row.status)}
                  </small>
                </span>
                <b>
                  {String(row.currency_code)} {String(row.outstanding_amount)}
                </b>
              </div>
            ))}
            {!dashboard.collectionCases.length ? (
              <p>No active collection cases.</p>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Invoice handoff</p>
          <h2>Sales requests needing attention</h2>
          <div className="accounting-list">
            {dashboard.importQueue.slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.request_number)}</strong>
                  <small>{String(row.sales_order_number)}</small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))}
            {!dashboard.importQueue.length ? (
              <p>No pending or failed invoice handoffs.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Invoice</span>
            <span>Customer</span>
            <span>Due date</span>
            <span>Status</span>
            <span>Governance</span>
            <span>Outstanding</span>
          </div>
          {dashboard.invoices.map((row) => {
            const health = (row.health || {}) as Record<string, unknown>;
            return (
              <Link
                className="accounting-table-row"
                href={`/accounting/receivables/${String(row.id)}`}
                key={String(row.id)}
              >
                <span>
                  <strong>{String(row.invoice_number)}</strong>
                  <small>{String(row.invoice_type)}</small>
                </span>
                <span>{String(row.customer_name)}</span>
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
          {!dashboard.invoices.length ? (
            <p>No customer invoices exist yet.</p>
          ) : null}
        </div>
      </section>
    </>
  );
}

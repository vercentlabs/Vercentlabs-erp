import { ConvergenceBoundary } from "@/shared/design";
import Link from "next/link";
import {
  getAccountingDashboard,
  listCustomerInvoices,
  listJournalEntries,
  listVendorBills,
} from "@vercentlabs/api";
import { formatMoney } from "@vercentlabs/localization";

import AppIcon, { type AppIconName } from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { accountingContext } from "@/modules/accounting";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function formatDate(value: unknown, locale: string) {
  if (!value) return "No date";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export default async function AccountingOverviewPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) {
    return (
      <section className="panel">
        <h1>Accounting access required</h1>
      </section>
    );
  }

  const context = accountingContext(session);
  const data = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getAccountingDashboard(client, context),
      journals: (await listJournalEntries(client, context)).slice(0, 5),
      invoices: (await listCustomerInvoices(client, context)).slice(0, 5),
      bills: (await listVendorBills(client, context)).slice(0, 5),
    }),
  )) as { dashboard: Row; journals: Row[]; invoices: Row[]; bills: Row[] };

  const dashboard = data.dashboard;
  const money = (value: unknown, currency = "INR") =>
    formatMoney(value, { currency, locale: session.locale });
  const documentMoney = (row: Row, valueKey: string) =>
    money(row[valueKey] || 0, String(row.currency_code || "INR"));

  const netWorkingCapital =
    Number(dashboard.receivables || 0) - Number(dashboard.payables || 0);

  return (
    <ConvergenceBoundary area="module" className="module-workbench accounting-workbench">
      <section className="module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="accounting" size={22} />
          </span>
          <div>
            <p className="eyebrow">Financial control</p>
            <h1>Accounting operations workspace</h1>
            <p>
              Run the ledger, collections, payments, reconciliation and close
              from a single evidence-backed financial workspace.
            </p>
          </div>
        </div>
        <div className="module-hero-actions">
          {hasPermission(session, PERMISSIONS.accountingJournalCreate) ? (
            <Link className="primary-button" href="/accounting/journals/new">
              New journal
            </Link>
          ) : null}
          {hasPermission(session, PERMISSIONS.accountingReceivablesManage) ? (
            <Link className="secondary-button" href="/accounting/receivables/new">
              New customer invoice
            </Link>
          ) : null}
          {hasPermission(session, PERMISSIONS.accountingPayablesManage) ? (
            <Link className="secondary-button" href="/accounting/payables/new">
              New vendor bill
            </Link>
          ) : null}
        </div>
      </section>

      <section className="module-metric-grid" aria-label="Financial position">
        {[
          {
            label: "Accounts receivable",
            value: money(dashboard.receivables),
            meta: `${money(dashboard.overdue_receivables)} overdue`,
            href: "/accounting/receivables",
            tone: "indigo",
            icon: "sales" as const,
          },
          {
            label: "Accounts payable",
            value: money(dashboard.payables),
            meta: `${money(dashboard.overdue_payables)} overdue`,
            href: "/accounting/payables",
            tone: "cyan",
            icon: "procurement" as const,
          },
          {
            label: "Net working position",
            value: money(netWorkingCapital),
            meta: "Receivables less payables",
            href: "/accounting/reports?report=cash-flow",
            tone: "emerald",
            icon: "accounting" as const,
          },
          {
            label: "Fixed asset book value",
            value: money(dashboard.fixed_asset_net_book_value),
            meta: "In-service and depreciated assets",
            href: "/accounting/assets",
            tone: "amber",
            icon: "assets" as const,
          },
        ].map((metric) => (
          <Link
            className={`module-metric-card tone-${metric.tone}`}
            href={metric.href}
            key={metric.label}
          >
            <span className="module-metric-icon" aria-hidden="true">
              <AppIcon name={metric.icon} size={18} />
            </span>
            <span className="module-metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.meta}</small>
            <span className="module-card-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <section className="attention-strip" aria-label="Accounting work queue">
        <Link href="/approvals">
          <span className="attention-dot warning" />
          <strong>{String(dashboard.pending_approvals || 0)}</strong>
          <span>Journal approvals pending</span>
        </Link>
        <Link href="/accounting/banking">
          <span className="attention-dot danger" />
          <strong>{String(dashboard.unreconciled_bank_lines || 0)}</strong>
          <span>Unreconciled bank lines</span>
        </Link>
        <Link href="/accounting/close">
          <span className="attention-dot info" />
          <strong>{String(dashboard.open_periods || 0)}</strong>
          <span>Fiscal periods currently open</span>
        </Link>
        <Link href="/accounting/journals">
          <span className="attention-dot success" />
          <strong>{String(dashboard.posted_journals || 0)}</strong>
          <span>Posted journal entries</span>
        </Link>
      </section>

      <section className="process-rail accounting-process-rail" aria-label="Record-to-report lifecycle">
        {[
          ["01", "Capture", "Subledger documents", "/accounting/receivables"],
          ["02", "Approve", "Governed postings", "/approvals"],
          ["03", "Post", "Balanced ledger", "/accounting/journals"],
          ["04", "Reconcile", "Cash and subledgers", "/accounting/banking"],
          ["05", "Close", "Period evidence", "/accounting/close"],
          ["06", "Report", "Financial statements", "/accounting/reports"],
        ].map(([number, label, description, href], index) => (
          <Link href={href} key={href}>
            <span className="process-rail-number">{number}</span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {index < 5 ? <i aria-hidden="true">→</i> : null}
          </Link>
        ))}
      </section>

      <div className="module-dashboard-grid module-dashboard-grid-three">
        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">General ledger</p>
              <h2>Recent journals</h2>
              <p>Balanced entries and their current posting state.</p>
            </div>
            <Link className="link-button" href="/accounting/journals">
              View all
            </Link>
          </div>
          <div className="document-feed compact-feed">
            {data.journals.map((row) => (
              <Link href={`/accounting/journals/${String(row.id)}`} key={String(row.id)}>
                <span className="document-feed-copy">
                  <strong>{String(row.entry_number)}</strong>
                  <small>{String(row.description || "Journal entry")}</small>
                </span>
                <span className="document-feed-value">
                  <strong>{money(row.total_debit, String(row.functional_currency_code || "INR"))}</strong>
                  <small className="status-badge neutral">{String(row.status)}</small>
                </span>
              </Link>
            ))}
            {!data.journals.length ? (
              <div className="module-empty-state compact">
                <strong>No journals yet</strong>
                <p>Create the first balanced entry for this company.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Receivables</p>
              <h2>Customer invoices</h2>
              <p>Outstanding customer balances and due dates.</p>
            </div>
            <Link className="link-button" href="/accounting/receivables">
              View all
            </Link>
          </div>
          <div className="document-feed compact-feed">
            {data.invoices.map((row) => (
              <Link href={`/accounting/receivables/${String(row.id)}`} key={String(row.id)}>
                <span className="document-feed-copy">
                  <strong>{String(row.invoice_number)}</strong>
                  <small>
                    {String(row.customer_name || "Customer")} · Due {formatDate(row.due_date, session.locale)}
                  </small>
                </span>
                <span className="document-feed-value">
                  <strong>{documentMoney(row, "outstanding_amount")}</strong>
                  <small className="status-badge neutral">{String(row.status)}</small>
                </span>
              </Link>
            ))}
            {!data.invoices.length ? (
              <div className="module-empty-state compact">
                <strong>No customer invoices yet</strong>
                <p>Posted invoices and collection exposure appear here.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Payables</p>
              <h2>Vendor bills</h2>
              <p>Supplier liabilities, matching status and due dates.</p>
            </div>
            <Link className="link-button" href="/accounting/payables">
              View all
            </Link>
          </div>
          <div className="document-feed compact-feed">
            {data.bills.map((row) => (
              <Link href={`/accounting/payables/${String(row.id)}`} key={String(row.id)}>
                <span className="document-feed-copy">
                  <strong>{String(row.bill_number)}</strong>
                  <small>
                    {String(row.supplier_name || "Supplier")} · Due {formatDate(row.due_date, session.locale)}
                  </small>
                </span>
                <span className="document-feed-value">
                  <strong>{documentMoney(row, "outstanding_amount")}</strong>
                  <small className="status-badge neutral">{String(row.status)}</small>
                </span>
              </Link>
            ))}
            {!data.bills.length ? (
              <div className="module-empty-state compact">
                <strong>No vendor bills yet</strong>
                <p>Supplier liabilities and payment exposure appear here.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel module-panel workflow-overview-panel">
        <div className="module-section-heading">
          <div>
            <p className="eyebrow">Financial workspaces</p>
            <h2>Operate by responsibility</h2>
            <p>Move from daily transactions to close and reporting without changing systems.</p>
          </div>
        </div>
        <div className="workflow-overview-grid accounting-workspace-grid">
          {[
            ["General ledger", "Journals, approvals, posting, reversal and audit history.", "/accounting/journals", "accounting" as const],
            ["Receivables", "Customer invoices, receipts, allocations and collections.", "/accounting/receivables", "sales" as const],
            ["Payables", "Vendor bills, matching, payments and due-date control.", "/accounting/payables", "procurement" as const],
            ["Banking", "Statements, matching suggestions and reconciliation.", "/accounting/banking", "billing" as const],
            ["Period close", "Task-driven close, locks and evidence packages.", "/accounting/close", "check" as const],
            ["Financial reports", "Statements, aging, tax, cash flow and reconciliations.", "/accounting/reports", "audit" as const],
          ].map(([title, description, href, icon]) => (
            <Link href={href} key={String(title)}>
              <span aria-hidden="true"><AppIcon name={icon as AppIconName} size={19} /></span>
              <strong>{title}</strong>
              <small>{description}</small>
              <b>Open workspace →</b>
            </Link>
          ))}
        </div>
      </section>
    </ConvergenceBoundary>
  );
}

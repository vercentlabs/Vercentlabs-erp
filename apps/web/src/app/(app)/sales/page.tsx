import Link from "next/link";
import {
  getSalesDashboard,
  listQuotations,
  listSalesOrders,
} from "@vercentlabs/api";
import { formatMoney } from "@vercentlabs/localization";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { salesContext } from "@/lib/sales";

export const dynamic = "force-dynamic";

type SalesRow = Record<string, unknown>;

function formatDate(value: unknown, locale: string) {
  if (!value) return "No date";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export default async function SalesOverviewPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.salesView)) {
    return (
      <section className="panel">
        <h1>Sales access required</h1>
      </section>
    );
  }

  const context = salesContext(session);
  const data = await tenantTransaction(context.organizationId, async (client) => ({
    dashboard: await getSalesDashboard(client, context),
    quotations: (await listQuotations(client, context)).slice(0, 6),
    orders: (await listSalesOrders(client, context)).slice(0, 6),
  }));
  const dashboard = data.dashboard as SalesRow;
  const baseMoney = (value: unknown) =>
    formatMoney(value, { currency: "INR", locale: session.locale });
  const documentMoney = (row: SalesRow) =>
    formatMoney(row.grand_total || 0, {
      currency: String(row.currency_code || "INR"),
      locale: session.locale,
    });

  const attentionCount =
    Number(dashboard.expiring_quotations || 0) +
    Number(dashboard.pending_quote_approvals || 0) +
    Number(dashboard.orders_on_hold || 0);

  return (
    <div className="module-workbench sales-workbench">
      <section className="module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="sales" size={22} />
          </span>
          <div>
            <p className="eyebrow">Order-to-cash</p>
            <h1>Commercial execution workspace</h1>
            <p>
              Build governed quotations, convert approved commitments and keep
              fulfilment, billing and customer promises visible in one flow.
            </p>
          </div>
        </div>
        <div className="module-hero-actions">
          <Link className="primary-button" href="/sales/quotations/new">
            New quotation
          </Link>
          <Link className="secondary-button" href="/sales/orders/new">
            New sales order
          </Link>
        </div>
      </section>

      <section className="module-metric-grid" aria-label="Sales performance">
        {[
          {
            label: "Confirmed order value",
            value: baseMoney(dashboard.confirmed_order_value),
            meta: "Approved customer commitments",
            href: "/sales/orders",
            tone: "indigo",
            icon: "sales" as const,
          },
          {
            label: "Active quotations",
            value: String(dashboard.active_quotations || 0),
            meta: `${String(dashboard.expiring_quotations || 0)} expire within 7 days`,
            href: "/sales/quotations",
            tone: "cyan",
            icon: "crm" as const,
          },
          {
            label: "Ready to invoice",
            value: String(dashboard.ready_to_invoice || 0),
            meta: "Orders cleared for Accounting",
            href: "/sales/orders",
            tone: "emerald",
            icon: "accounting" as const,
          },
          {
            label: "Items needing attention",
            value: String(attentionCount),
            meta: "Expiry, approval and hold queues",
            href: "/sales/reports",
            tone: "amber",
            icon: "approvals" as const,
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

      <section className="process-rail" aria-label="Order-to-cash lifecycle">
        {[
          ["01", "Qualify", "CRM opportunity", "/crm/opportunities"],
          ["02", "Propose", "Governed quotation", "/sales/quotations"],
          ["03", "Approve", "Commercial controls", "/approvals"],
          ["04", "Commit", "Confirmed sales order", "/sales/orders"],
          ["05", "Invoice", "Accounting handoff", "/accounting/receivables"],
        ].map(([number, label, description, href], index) => (
          <Link href={href} key={href}>
            <span className="process-rail-number">{number}</span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {index < 4 ? <i aria-hidden="true">→</i> : null}
          </Link>
        ))}
      </section>

      <section className="attention-strip" aria-label="Sales attention queue">
        <Link href="/sales/quotations?status=all">
          <span className="attention-dot warning" />
          <strong>{String(dashboard.expiring_quotations || 0)}</strong>
          <span>Quotations expiring soon</span>
        </Link>
        <Link href="/approvals">
          <span className="attention-dot info" />
          <strong>{String(dashboard.pending_quote_approvals || 0)}</strong>
          <span>Commercial approvals pending</span>
        </Link>
        <Link href="/sales/orders?status=on_hold">
          <span className="attention-dot danger" />
          <strong>{String(dashboard.orders_on_hold || 0)}</strong>
          <span>Orders currently on hold</span>
        </Link>
        <Link href="/sales/orders">
          <span className="attention-dot success" />
          <strong>{String(dashboard.ready_to_invoice || 0)}</strong>
          <span>Orders ready for invoicing</span>
        </Link>
      </section>

      <div className="module-dashboard-grid module-dashboard-grid-even">
        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Quotations</p>
              <h2>Recent commercial proposals</h2>
              <p>Review validity, customer and commercial value at a glance.</p>
            </div>
            <Link className="link-button" href="/sales/quotations">
              View all
            </Link>
          </div>
          <div className="document-feed">
            {data.quotations.map((row) => (
              <Link href={`/sales/quotations/${String(row.id)}`} key={String(row.id)}>
                <span className="document-feed-icon" aria-hidden="true">
                  <AppIcon name="sales" size={17} />
                </span>
                <span className="document-feed-copy">
                  <strong>{String(row.quotation_number)}</strong>
                  <small>
                    {String(row.customer_name || "Customer")} · Valid to {formatDate(row.valid_until, session.locale)}
                  </small>
                </span>
                <span className="document-feed-value">
                  <strong>{documentMoney(row as SalesRow)}</strong>
                  <small className="status-badge neutral">{String(row.lifecycle_status)}</small>
                </span>
              </Link>
            ))}
            {!data.quotations.length ? (
              <div className="module-empty-state compact">
                <strong>No quotations yet</strong>
                <p>Create a proposal from a customer opportunity or directly.</p>
                <Link className="secondary-button" href="/sales/quotations/new">
                  Create quotation
                </Link>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Sales orders</p>
              <h2>Recent customer commitments</h2>
              <p>Keep lifecycle, fulfilment and billing readiness visible.</p>
            </div>
            <Link className="link-button" href="/sales/orders">
              View all
            </Link>
          </div>
          <div className="document-feed">
            {data.orders.map((row) => (
              <Link href={`/sales/orders/${String(row.id)}`} key={String(row.id)}>
                <span className="document-feed-icon" aria-hidden="true">
                  <AppIcon name="check" size={17} />
                </span>
                <span className="document-feed-copy">
                  <strong>{String(row.sales_order_number)}</strong>
                  <small>
                    {String(row.customer_name || "Customer")} · {formatDate(row.order_date, session.locale)}
                  </small>
                </span>
                <span className="document-feed-value">
                  <strong>{documentMoney(row as SalesRow)}</strong>
                  <small className="status-badge neutral">{String(row.lifecycle_status)}</small>
                </span>
              </Link>
            ))}
            {!data.orders.length ? (
              <div className="module-empty-state compact">
                <strong>No sales orders yet</strong>
                <p>Convert an accepted quotation or create a governed order.</p>
                <Link className="secondary-button" href="/sales/orders/new">
                  Create sales order
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel module-panel workflow-overview-panel">
        <div className="module-section-heading">
          <div>
            <p className="eyebrow">Commercial controls</p>
            <h2>Operate with clean handoffs</h2>
            <p>Each workspace owns one decision in the order-to-cash process.</p>
          </div>
        </div>
        <div className="workflow-overview-grid">
          {[
            ["Pricing & margin", "Preview server-calculated prices, discounts, tax and margin before committing.", "/sales/quotations/new", "sparkles" as const],
            ["Approvals", "Route non-standard commercial terms through separation-of-duties controls.", "/approvals", "approvals" as const],
            ["Fulfilment", "Track ordered, confirmed, fulfilled and invoiced quantities independently.", "/sales/orders", "check" as const],
            ["Performance", "Review conversion, intake, holds, fulfilment and customer performance.", "/sales/reports", "audit" as const],
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
    </div>
  );
}

import {
  ActionLink,
  ConvergenceBoundary,
  MetricCard,
  PageHeader,
  PermissionState,
  SectionHeader,
  StatePanel,
  StatusBadge,
  Surface,
} from "@/shared/design";
import Link from "next/link";
import {
  getSalesDashboard,
  listQuotations,
  listSalesOrders,
} from "@vercentlabs/api";
import { formatMoney } from "@vercentlabs/localization";

import AppIcon, { type AppIconName } from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { salesContext } from "@/modules/sales";

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
        <PermissionState title="Sales access required" />
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
    <ConvergenceBoundary area="module" className="module-workbench sales-workbench">
      <PageHeader
        eyebrow="Order-to-cash"
        title="Commercial execution workspace"
        description="Build governed quotations, convert approved commitments and keep fulfilment, billing and customer promises visible in one flow."
        actions={
          <>
            <ActionLink tone="primary" href="/sales/quotations/new">
              New quotation
            </ActionLink>
            <ActionLink href="/sales/orders/new">New sales order</ActionLink>
          </>
        }
      />

      <section className="module-metric-grid" aria-label="Sales performance">
        {[
          {
            label: "Confirmed order value",
            value: baseMoney(dashboard.confirmed_order_value),
            meta: "Approved customer commitments",
            href: "/sales/orders",
            tone: "info" as const,
            icon: "sales" as const,
          },
          {
            label: "Active quotations",
            value: String(dashboard.active_quotations || 0),
            meta: `${String(dashboard.expiring_quotations || 0)} expire within 7 days`,
            href: "/sales/quotations",
            tone: "info" as const,
            icon: "crm" as const,
          },
          {
            label: "Ready to invoice",
            value: String(dashboard.ready_to_invoice || 0),
            meta: "Orders cleared for Accounting",
            href: "/sales/orders",
            tone: "success" as const,
            icon: "accounting" as const,
          },
          {
            label: "Items needing attention",
            value: String(attentionCount),
            meta: "Expiry, approval and hold queues",
            href: "/sales/reports",
            tone: "warning" as const,
            icon: "approvals" as const,
          },
        ].map((metric) => (
          <Link href={metric.href} key={metric.label}>
            <MetricCard
              tone={metric.tone}
              icon={<AppIcon name={metric.icon} size={18} />}
              label={metric.label}
              value={metric.value}
              hint={metric.meta}
            />
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
          <MetricCard
            tone="warning"
            label="Quotations expiring soon"
            value={String(dashboard.expiring_quotations || 0)}
          />
        </Link>
        <Link href="/approvals">
          <MetricCard
            tone="info"
            label="Commercial approvals pending"
            value={String(dashboard.pending_quote_approvals || 0)}
          />
        </Link>
        <Link href="/sales/orders?status=on_hold">
          <MetricCard
            tone="danger"
            label="Orders currently on hold"
            value={String(dashboard.orders_on_hold || 0)}
          />
        </Link>
        <Link href="/sales/orders">
          <MetricCard
            tone="success"
            label="Orders ready for invoicing"
            value={String(dashboard.ready_to_invoice || 0)}
          />
        </Link>
      </section>

      <div className="module-dashboard-grid module-dashboard-grid-even">
        <Surface as="section" className="panel module-panel">
          <SectionHeader
            eyebrow="Quotations"
            title="Recent commercial proposals"
            description="Review validity, customer and commercial value at a glance."
            actions={<Link href="/sales/quotations">View all</Link>}
          />
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
                  <StatusBadge tone="neutral">{String(row.lifecycle_status)}</StatusBadge>
                </span>
              </Link>
            ))}
            {!data.quotations.length ? (
              <StatePanel
                title="No quotations yet"
                description="Create a proposal from a customer opportunity or directly."
                action={
                  <ActionLink href="/sales/quotations/new">
                    Create quotation
                  </ActionLink>
                }
              />
            ) : null}
          </div>
        </Surface>

        <Surface as="section" className="panel module-panel">
          <SectionHeader
            eyebrow="Sales orders"
            title="Recent customer commitments"
            description="Keep lifecycle, fulfilment and billing readiness visible."
            actions={<Link href="/sales/orders">View all</Link>}
          />
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
                  <StatusBadge tone="neutral">{String(row.lifecycle_status)}</StatusBadge>
                </span>
              </Link>
            ))}
            {!data.orders.length ? (
              <StatePanel
                title="No sales orders yet"
                description="Convert an accepted quotation or create a governed order."
                action={
                  <ActionLink href="/sales/orders/new">
                    Create sales order
                  </ActionLink>
                }
              />
            ) : null}
          </div>
        </Surface>
      </div>

      <Surface as="section" className="panel module-panel workflow-overview-panel">
        <SectionHeader
          eyebrow="Commercial controls"
          title="Operate with clean handoffs"
          description="Each workspace owns one decision in the order-to-cash process."
        />
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
      </Surface>
    </ConvergenceBoundary>
  );
}

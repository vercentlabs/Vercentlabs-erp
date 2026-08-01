import {
  getQuotationGovernanceDashboard,
  listQuotations,
} from "@vercentlabs/api";
import Link from "next/link";

import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { salesContext } from "@/lib/sales";

export const dynamic = "force-dynamic";

type GovernanceSummary = {
  active?: number;
  activeValue?: number;
  pendingApproval?: number;
  expiring?: number;
  attention?: number;
  blocked?: number;
};

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.salesView)) {
    return <AccessDenied area="Sales quotations" />;
  }

  const context = salesContext(session);
  const filters = await searchParams;
  const data = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      rows: await listQuotations(client, context, filters),
      governance: await getQuotationGovernanceDashboard(client, context),
    }),
  );
  const governance = data.governance as {
    summary?: GovernanceSummary;
  };
  const summary = governance.summary || {};

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Sales · Quotations</p>
          <h1>Commercial proposals</h1>
          <p>
            Every customer-facing revision remains immutable and independently
            auditable.
          </p>
        </div>
        <Link className="primary-button" href="/sales/quotations/new">
          New quotation
        </Link>
      </section>

      <section className="module-metric-grid" aria-label="Quotation governance">
        {[
          {
            label: "Active quotations",
            value: String(summary.active || 0),
            meta: `${String(summary.expiring || 0)} approaching expiry`,
          },
          {
            label: "Active commercial value",
            value: `INR ${String(summary.activeValue || 0)}`,
            meta: "Base-currency governance view",
          },
          {
            label: "Pending approvals",
            value: String(summary.pendingApproval || 0),
            meta: "Commercial decisions awaiting action",
          },
          {
            label: "Needs attention",
            value: String(
              Number(summary.attention || 0) + Number(summary.blocked || 0),
            ),
            meta: `${String(summary.blocked || 0)} currently blocked`,
          },
        ].map((metric) => (
          <article
            className="module-metric-card tone-indigo"
            key={metric.label}
          >
            <span className="module-metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.meta}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <form className="sales-filter">
          <input
            name="search"
            defaultValue={filters.search}
            placeholder="Search quotation or customer"
          />
          <select name="status" defaultValue={filters.status || "all"}>
            <option value="all">All statuses</option>
            {[
              "draft",
              "pending_approval",
              "approved",
              "sent",
              "viewed",
              "accepted",
              "rejected",
              "expired",
              "converted",
              "cancelled",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <button className="secondary-button">Apply</button>
        </form>
        <div className="sales-table">
          <div className="sales-table-row sales-table-head">
            <span>Quotation</span>
            <span>Customer</span>
            <span>Status</span>
            <span>Valid until</span>
            <span>Total</span>
          </div>
          {data.rows.map((row) => (
            <Link
              className="sales-table-row"
              href={`/sales/quotations/${row.id}`}
              key={row.id}
            >
              <span>
                <strong>{row.quotation_number}</strong>
                <small>Revision {row.version_number}</small>
              </span>
              <span>{row.customer_name}</span>
              <span>
                <i className="status-badge neutral">{row.lifecycle_status}</i>
              </span>
              <span>{String(row.valid_until).slice(0, 10)}</span>
              <span>
                {row.currency_code} {row.grand_total}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

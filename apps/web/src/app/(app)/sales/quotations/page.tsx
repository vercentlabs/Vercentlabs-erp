import {
  getQuotationGovernanceDashboard,
  listQuotations,
} from "@vercentlabs/api";
import Link from "next/link";

import AccessDenied from "@/shared/components/access-denied";
import DownwardSelect from "@/shared/components/downward-select";
import PaginationLinks from "@/shared/components/pagination-links";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { salesContext } from "@/modules/sales";

export const dynamic = "force-dynamic";

type GovernanceSummary = {
  active?: number;
  activeValue?: number;
  pendingApproval?: number;
  expiring?: number;
  attention?: number;
  blocked?: number;
};

const PAGE_SIZE = 10;

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
  const totalItems = data.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const requestedPage = Math.max(1, Number(filters.page) || 1);
  const page = Math.min(requestedPage, totalPages);
  const visibleRows = data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
            aria-label="Search quotation or customer"
          />
          <DownwardSelect
            name="status"
            ariaLabel="Filter quotations by status"
            defaultValue={filters.status || "all"}
            options={[
              { value: "all", label: "All statuses" },
              ...[
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
              ].map((status) => ({
                value: status,
                label: status.replaceAll("_", " "),
              })),
            ]}
          />
          <button className="secondary-button">Apply</button>
        </form>
        <div className="sales-table" role="table" aria-label="Quotations">
          <div className="sales-table-row sales-table-head" role="row">
            <span role="columnheader">Quotation</span>
            <span role="columnheader">Customer</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Valid until</span>
            <span role="columnheader">Total</span>
          </div>
          {visibleRows.map((row) => (
            <Link
              className="sales-table-row"
              href={`/sales/quotations/${row.id}`}
              key={row.id}
              role="row"
            >
              <span role="cell">
                <strong>{row.quotation_number}</strong>
                <small>Revision {row.version_number}</small>
              </span>
              <span role="cell">{row.customer_name}</span>
              <span role="cell">
                <i className="status-badge neutral">{row.lifecycle_status}</i>
              </span>
              <span role="cell">{String(row.valid_until).slice(0, 10)}</span>
              <span role="cell">
                {row.currency_code} {row.grand_total}
              </span>
            </Link>
          ))}
        </div>
        <PaginationLinks
          pathname="/sales/quotations"
          query={filters}
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={totalItems}
        />
      </section>
    </>
  );
}

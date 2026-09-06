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
import {
  EnterpriseDataGrid,
  FilterBar,
  MetricCard,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

type QuotationRow = Record<string, unknown>;

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
        <MetricCard
          label="Active quotations"
          value={String(summary.active || 0)}
          hint={`${String(summary.expiring || 0)} approaching expiry`}
        />
        <MetricCard
          label="Active commercial value"
          value={`INR ${String(summary.activeValue || 0)}`}
          hint="Base-currency governance view"
        />
        <MetricCard
          label="Pending approvals"
          value={String(summary.pendingApproval || 0)}
          hint="Commercial decisions awaiting action"
        />
        <MetricCard
          label="Needs attention"
          value={String(
            Number(summary.attention || 0) + Number(summary.blocked || 0),
          )}
          hint={`${String(summary.blocked || 0)} currently blocked`}
        />
      </section>

      <section className="panel">
        <form>
          <FilterBar label="Filter quotations">
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
          </FilterBar>
        </form>
        {(() => {
          const columns: DataGridColumn<QuotationRow>[] = [
            {
              id: "quotation",
              header: "Quotation",
              cell: (row) => (
                <Link href={`/sales/quotations/${row.id}`}>
                  <strong>{String(row.quotation_number)}</strong>
                  <small> Revision {String(row.version_number)}</small>
                </Link>
              ),
            },
            {
              id: "customer",
              header: "Customer",
              cell: (row) => String(row.customer_name),
            },
            {
              id: "status",
              header: "Status",
              cell: (row) => (
                <StatusBadge tone="neutral">
                  {String(row.lifecycle_status)}
                </StatusBadge>
              ),
            },
            {
              id: "validUntil",
              header: "Valid until",
              cell: (row) => String(row.valid_until).slice(0, 10),
            },
            {
              id: "total",
              header: "Total",
              cell: (row) => `${String(row.currency_code)} ${String(row.grand_total)}`,
            },
          ];
          return (
            <EnterpriseDataGrid
              caption="Quotations"
              rows={visibleRows}
              rowKey={(row) => String(row.id)}
              columns={columns}
              emptyState={<StatePanel title="No quotations yet" />}
            />
          );
        })()}
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

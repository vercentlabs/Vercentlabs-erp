import {
  getSalesOrderGovernanceDashboard,
  listSalesOrders,
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

type SalesOrderRow = Record<string, unknown>;

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.salesView)) {
    return <AccessDenied area="Sales orders" />;
  }

  const context = salesContext(session);
  const filters = await searchParams;
  const { rows, governance } = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      rows: await listSalesOrders(client, context, filters),
      governance: await getSalesOrderGovernanceDashboard(client, context),
    }),
  );
  const summary = governance.summary as Record<string, unknown>;
  const summaryCards: Array<[string, unknown]> = [
    ["Active orders", summary.active],
    ["Pending approval", summary.pendingApproval],
    ["Ready to fulfil", summary.readyToFulfill],
    ["Ready to invoice", summary.readyToInvoice],
    ["On hold", summary.onHold],
  ];
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const requestedPage = Math.max(1, Number(filters.page) || 1);
  const page = Math.min(requestedPage, totalPages);
  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Sales · Orders</p>
          <h1>Customer commitments</h1>
          <p>
            Track credit, fulfilment and billing independently across every
            confirmed order.
          </p>
        </div>
        <Link className="primary-button" href="/sales/orders/new">
          New order
        </Link>
      </section>
      <section className="sales-status-strip">
        {summaryCards.map(([label, value]) => (
          <MetricCard key={label} label={label} value={String(value ?? 0)} />
        ))}
      </section>
      <section className="panel">
        <form>
          <FilterBar label="Filter sales orders">
            <input
              name="search"
              defaultValue={filters.search}
              placeholder="Search order or customer"
              aria-label="Search order or customer"
            />
            <DownwardSelect
              name="status"
              ariaLabel="Filter sales orders by status"
              defaultValue={filters.status || "all"}
              options={[
                { value: "all", label: "All statuses" },
                ...[
                  "draft",
                  "pending_approval",
                  "confirmed",
                  "on_hold",
                  "cancelled",
                  "closed",
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
          const columns: DataGridColumn<SalesOrderRow>[] = [
            {
              id: "order",
              header: "Order",
              cell: (row) => (
                <Link href={`/sales/orders/${row.id}`}>
                  <strong>{String(row.sales_order_number)}</strong>
                  <small> {String(row.order_date).slice(0, 10)}</small>
                </Link>
              ),
            },
            {
              id: "customer",
              header: "Customer",
              cell: (row) => String(row.customer_name),
            },
            {
              id: "lifecycle",
              header: "Lifecycle",
              cell: (row) => (
                <StatusBadge tone="neutral">
                  {String(row.lifecycle_status)}
                </StatusBadge>
              ),
            },
            {
              id: "fulfilment",
              header: "Fulfilment",
              cell: (row) => (
                <StatusBadge tone="neutral">
                  {String(row.fulfillment_status)}
                </StatusBadge>
              ),
            },
            {
              id: "total",
              header: "Total",
              cell: (row) => `${String(row.currency_code)} ${String(row.grand_total)}`,
            },
          ];
          return (
            <EnterpriseDataGrid
              caption="Sales orders"
              rows={visibleRows}
              rowKey={(row) => String(row.id)}
              columns={columns}
              emptyState={<StatePanel title="No sales orders yet" />}
            />
          );
        })()}
        <PaginationLinks
          pathname="/sales/orders"
          query={filters}
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={totalItems}
        />
      </section>
    </>
  );
}

import { listSalesOrders } from "@vercentlabs/api";
import Link from "next/link";

import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { salesContext } from "@/lib/sales";

export const dynamic = "force-dynamic";

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
  const rows = await tenantTransaction(context.organizationId, (client) =>
    listSalesOrders(client, context, filters),
  );

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
      <section className="panel">
        <form className="sales-filter">
          <input
            name="search"
            defaultValue={filters.search}
            placeholder="Search order or customer"
          />
          <select name="status" defaultValue={filters.status || "all"}>
            <option value="all">All statuses</option>
            {[
              "draft",
              "pending_approval",
              "confirmed",
              "on_hold",
              "cancelled",
              "closed",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <button className="secondary-button">Apply</button>
        </form>
        <div className="sales-table">
          <div className="sales-table-row sales-table-head">
            <span>Order</span>
            <span>Customer</span>
            <span>Lifecycle</span>
            <span>Fulfilment</span>
            <span>Total</span>
          </div>
          {rows.map((row) => (
            <Link
              className="sales-table-row"
              href={`/sales/orders/${row.id}`}
              key={row.id}
            >
              <span>
                <strong>{row.sales_order_number}</strong>
                <small>{String(row.order_date).slice(0, 10)}</small>
              </span>
              <span>{row.customer_name}</span>
              <span>{row.lifecycle_status}</span>
              <span>{row.fulfillment_status}</span>
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

import { assessSalesOrderReadiness, getSalesOrder } from "@vercentlabs/api";
import { notFound } from "next/navigation";

import SalesDocumentActions from "@/components/sales-document-actions";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { salesContext } from "@/lib/sales";

export const dynamic = "force-dynamic";

type OrderLineView = {
  id: string;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  quantity: string | number;
  confirmed_quantity: string | number;
  fulfilled_quantity: string | number;
  invoiced_quantity: string | number;
  remaining_to_fulfill: string | number;
};

type OrderHoldView = {
  id: string;
  hold_type: string;
  reason: string;
  status: string;
};

type HandoffRequestView = {
  id: string;
  request_number: string;
  status: string;
};

type DocumentEventView = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  occurred_at: string | Date;
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();

  if (!hasPermission(session, PERMISSIONS.salesView)) {
    return notFound();
  }

  const context = salesContext(session);
  let data: Awaited<ReturnType<typeof getSalesOrder>>;
  let governance: Awaited<ReturnType<typeof assessSalesOrderReadiness>>;

  try {
    ({ data, governance } = await tenantTransaction(
      context.organizationId,
      async (client) => ({
        data: await getSalesOrder(client, context, id),
        governance: await assessSalesOrderReadiness(client, context, id),
      }),
    ));
  } catch {
    return notFound();
  }

  const order = data.order;
  const health = governance.health as {
    readiness?: string;
    blockers?: string[];
    warnings?: string[];
    readyToFulfill?: boolean;
    readyToInvoice?: boolean;
    readyToClose?: boolean;
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Sales order</p>
          <h1>{order.sales_order_number}</h1>
          <p>
            {order.customer_snapshot?.displayName || "Customer"} ·{" "}
            {order.currency_code} {order.grand_total}
          </p>
        </div>
        <span className="status-badge neutral">{order.lifecycle_status}</span>
      </section>

      <SalesDocumentActions
        type="order"
        id={id}
        status={order.lifecycle_status}
      />

      <section className="panel">
        <p className="eyebrow">Order governance</p>
        <h2>Commercial and operational readiness</h2>
        <div className="sales-status-strip">
          {[
            ["Readiness", health.readiness || "unknown"],
            ["Fulfilment", health.readyToFulfill ? "ready" : "not ready"],
            ["Invoicing", health.readyToInvoice ? "ready" : "not ready"],
            ["Closure", health.readyToClose ? "ready" : "not ready"],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {[...(health.blockers || []), ...(health.warnings || [])].length > 0 ? (
          <div className="sales-document-list">
            {[...(health.blockers || []), ...(health.warnings || [])].map(
              (message) => (
                <div key={message}>
                  <span>{message}</span>
                </div>
              ),
            )}
          </div>
        ) : (
          <p>No governance blockers or warnings are active.</p>
        )}
      </section>

      <section className="sales-status-strip">
        {[
          ["Approval", order.approval_status],
          ["Credit", order.credit_status],
          ["Fulfilment", order.fulfillment_status],
          ["Billing", order.billing_status],
          ["Payment", order.payment_status],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="panel">
        <p className="eyebrow">Order lines</p>
        <h2>Quantity lifecycle</h2>
        <div className="sales-table sales-order-table">
          <div className="sales-table-row sales-table-head">
            <span>Item</span>
            <span>Ordered</span>
            <span>Confirmed</span>
            <span>Fulfilled</span>
            <span>Invoiced</span>
            <span>Remaining</span>
          </div>
          {data.lines.map((line: OrderLineView) => (
            <div className="sales-table-row" key={line.id}>
              <span>
                <strong>{line.item_code_snapshot}</strong>
                <small>{line.item_name_snapshot}</small>
              </span>
              <span>{line.quantity}</span>
              <span>{line.confirmed_quantity}</span>
              <span>{line.fulfilled_quantity}</span>
              <span>{line.invoiced_quantity}</span>
              <span>{line.remaining_to_fulfill}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="sales-two-column">
        <section className="panel">
          <p className="eyebrow">Holds and handoffs</p>
          <h2>Operational controls</h2>
          <div className="sales-document-list">
            {data.holds.map((hold: OrderHoldView) => (
              <div key={hold.id}>
                <span>
                  <strong>{hold.hold_type} hold</strong>
                  <small>{hold.reason}</small>
                </span>
                <b>{hold.status}</b>
              </div>
            ))}
            {data.fulfillmentRequests.map((request: HandoffRequestView) => (
              <div key={request.id}>
                <span>
                  <strong>{request.request_number}</strong>
                  <small>Inventory fulfilment request</small>
                </span>
                <b>{request.status}</b>
              </div>
            ))}
            {data.invoiceRequests.map((request: HandoffRequestView) => (
              <div key={request.id}>
                <span>
                  <strong>{request.request_number}</strong>
                  <small>Accounting invoice request</small>
                </span>
                <b>{request.status}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Document flow</p>
          <h2>Order history</h2>
          <div className="sales-document-list">
            {data.events.map((event: DocumentEventView) => (
              <div key={event.id}>
                <span>
                  <strong>{event.event_type}</strong>
                  <small>
                    {event.from_status || "Created"} →{" "}
                    {event.to_status || event.from_status || "Recorded"}
                  </small>
                </span>
                <time>
                  {new Date(event.occurred_at).toLocaleString("en-IN")}
                </time>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

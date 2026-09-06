import {
  EnterpriseDataGrid,
  MetricCard,
  PageHeader,
  StatePanel,
  StatusBadge,
  Surface,
  TransactionDocumentArchetype,
  type DataGridColumn,
} from "@/shared/design";
import { assessSalesOrderReadiness, getSalesOrder } from "@vercentlabs/api";
import { notFound } from "next/navigation";

import SalesDocumentActions from "@/modules/sales/components/document-actions";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { salesContext } from "@/modules/sales";

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
    <TransactionDocumentArchetype aria-label="Transaction document">
      <PageHeader
        eyebrow="Sales order"
        title={order.sales_order_number}
        description={`${order.customer_snapshot?.displayName || "Customer"} · ${order.currency_code} ${order.grand_total}`}
        context={<StatusBadge tone="neutral">{order.lifecycle_status}</StatusBadge>}
      />

      <SalesDocumentActions
        type="order"
        id={id}
        status={order.lifecycle_status}
      />

      <Surface as="section">
        <p className="eyebrow">Order governance</p>
        <h2>Commercial and operational readiness</h2>
        <div className="sales-status-strip">
          <MetricCard label="Readiness" value={health.readiness || "unknown"} />
          <MetricCard
            label="Fulfilment"
            value={health.readyToFulfill ? "ready" : "not ready"}
          />
          <MetricCard
            label="Invoicing"
            value={health.readyToInvoice ? "ready" : "not ready"}
          />
          <MetricCard
            label="Closure"
            value={health.readyToClose ? "ready" : "not ready"}
          />
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
          <StatePanel title="No governance blockers or warnings are active." />
        )}
      </Surface>

      <section className="sales-status-strip">
        <MetricCard label="Approval" value={order.approval_status} />
        <MetricCard label="Credit" value={order.credit_status} />
        <MetricCard label="Fulfilment" value={order.fulfillment_status} />
        <MetricCard label="Billing" value={order.billing_status} />
        <MetricCard label="Payment" value={order.payment_status} />
      </section>

      <Surface as="section">
        <p className="eyebrow">Order lines</p>
        <h2>Quantity lifecycle</h2>
        {(() => {
          const columns: DataGridColumn<OrderLineView>[] = [
            {
              id: "item",
              header: "Item",
              cell: (line) => (
                <>
                  <strong>{line.item_code_snapshot}</strong>
                  <small> {line.item_name_snapshot}</small>
                </>
              ),
            },
            { id: "ordered", header: "Ordered", cell: (line) => line.quantity },
            {
              id: "confirmed",
              header: "Confirmed",
              cell: (line) => line.confirmed_quantity,
            },
            {
              id: "fulfilled",
              header: "Fulfilled",
              cell: (line) => line.fulfilled_quantity,
            },
            {
              id: "invoiced",
              header: "Invoiced",
              cell: (line) => line.invoiced_quantity,
            },
            {
              id: "remaining",
              header: "Remaining",
              cell: (line) => line.remaining_to_fulfill,
            },
          ];
          return (
            <EnterpriseDataGrid
              caption="Order lines"
              rows={data.lines}
              rowKey={(line) => line.id}
              columns={columns}
              emptyState={<StatePanel title="No order lines yet." />}
            />
          );
        })()}
      </Surface>

      <div className="sales-two-column">
        <Surface as="section">
          <p className="eyebrow">Holds and handoffs</p>
          <h2>Operational controls</h2>
          <div className="sales-document-list">
            {data.holds.map((hold: OrderHoldView) => (
              <div key={hold.id}>
                <span>
                  <strong>{hold.hold_type} hold</strong>
                  <small>{hold.reason}</small>
                </span>
                <StatusBadge tone="neutral">{hold.status}</StatusBadge>
              </div>
            ))}
            {data.fulfillmentRequests.map((request: HandoffRequestView) => (
              <div key={request.id}>
                <span>
                  <strong>{request.request_number}</strong>
                  <small>Inventory fulfilment request</small>
                </span>
                <StatusBadge tone="neutral">{request.status}</StatusBadge>
              </div>
            ))}
            {data.invoiceRequests.map((request: HandoffRequestView) => (
              <div key={request.id}>
                <span>
                  <strong>{request.request_number}</strong>
                  <small>Accounting invoice request</small>
                </span>
                <StatusBadge tone="neutral">{request.status}</StatusBadge>
              </div>
            ))}
          </div>
        </Surface>

        <Surface as="section">
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
        </Surface>
      </div>
    </TransactionDocumentArchetype>
  );
}

// Many orders at once (Sales plan, Flows 2 and 3): select orders on a list and make their challans (deliveries) or invoices in one go —
// one delivery per order and warehouse, one invoice per order — each the same as making it from the order. Each order is its own step:
// one that cannot be done is reported and the others still are.
import { createDeliveryFromSalesOrder } from "./deliveries/records.js";
import { createInvoiceFromSalesOrder } from "./invoices/records.js";
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ORDERS = 100;

function orderIdsOf(input) {
  const ids = [...new Set((Array.isArray(input.orderIds) ? input.orderIds : []).filter((id) => UUID.test(String(id))))];
  if (!ids.length) throw new SalesError(400, "Choose the orders.", "SALES_BULK_INVALID");
  if (ids.length > MAX_ORDERS) throw new SalesError(400, `Choose at most ${MAX_ORDERS} orders at a time.`, "SALES_BULK_INVALID");
  const key = String(input.idempotencyKey ?? "").trim().slice(0, 120);
  if (!key) throw new SalesError(400, "A request key is required.", "SALES_BULK_INVALID");
  return { ids, key };
}

async function step(client, name, work) {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, result };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    if (!error?.status || error.status >= 500) throw error;
    return { ok: false, error: String(error.message ?? error) };
  }
}

const numberOf = async (client, organizationId, orderId) =>
  (await client.query("SELECT sales_order_number FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2", [organizationId, orderId])).rows[0]?.sales_order_number ?? null;

// input: { orderIds, idempotencyKey, dispatch? } — every confirmed order's deliverable goods, one delivery per warehouse.
// Returns { results: [{ orderId, orderNumber, deliveries: [{ deliveryId, deliveryNumber }], error? }] }.
export async function createDeliveriesForOrders(client, context, input = {}) {
  const { ids, key } = orderIdsOf(input);
  const results = [];
  for (const orderId of ids) {
    const deliveries = [];
    let error = null;
    // Each call takes what is deliverable from one warehouse (the next one with goods left), so a few calls cover them all.
    for (let round = 0; round < 10; round += 1) {
      const done = await step(client, "sales_bulk_delivery", () => createDeliveryFromSalesOrder(client, context, orderId, { idempotencyKey: `${key}:${orderId}:${round}`, dispatch: Boolean(input.dispatch) }));
      if (!done.ok) { if (!deliveries.length) error = done.error; break; }
      if (done.result.replayed && deliveries.some((entry) => entry.deliveryId === done.result.deliveryId)) break;
      deliveries.push({ deliveryId: done.result.deliveryId, deliveryNumber: done.result.deliveryNumber });
    }
    results.push({ orderId, orderNumber: await numberOf(client, context.organizationId, orderId), deliveries, ...(error ? { error } : {}) });
  }
  return { results, created: results.reduce((total, entry) => total + entry.deliveries.length, 0) };
}

// input: { orderIds, idempotencyKey } — everything each order can be billed for now (by order or by dispatch, per Sales settings).
// Returns { results: [{ orderId, orderNumber, invoiceId?, invoiceNumber?, error? }] }.
export async function createInvoicesForOrders(client, context, input = {}) {
  const { ids, key } = orderIdsOf(input);
  const results = [];
  for (const orderId of ids) {
    const done = await step(client, "sales_bulk_invoice", () => createInvoiceFromSalesOrder(client, context, orderId, { idempotencyKey: `${key}:${orderId}` }));
    results.push({ orderId, orderNumber: await numberOf(client, context.organizationId, orderId),
      ...(done.ok ? { invoiceId: done.result.invoiceId, invoiceNumber: done.result.invoiceNumber } : { error: done.error }) });
  }
  return { results, created: results.filter((entry) => entry.invoiceId).length };
}

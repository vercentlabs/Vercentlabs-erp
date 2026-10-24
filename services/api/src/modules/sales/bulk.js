// Many orders at once (Sales plan, Flows 2 and 3): select orders on a list and make their challans (deliveries) or invoices in one go —
// one delivery per order and warehouse, one invoice per order — each the same as making it from the order. Many invoices at once (Sales
// report H2): finalise the drafts, then email them. Each order or invoice is its own step: one that cannot be done is reported and the
// others still are.
import { createDeliveryFromSalesOrder } from "./deliveries/records.js";
import { loadInvoice } from "./invoices/access.js";
import { sendSalesInvoice } from "./invoices/communication.js";
import { postSalesInvoice } from "./invoices/lifecycle.js";
import { createInvoiceFromSalesOrder } from "./invoices/records.js";
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ORDERS = 100;

function idsOf(input, field = "orderIds", noun = "orders") {
  const ids = [...new Set((Array.isArray(input[field]) ? input[field] : []).filter((id) => UUID.test(String(id))))];
  if (!ids.length) throw new SalesError(400, `Choose the ${noun}.`, "SALES_BULK_INVALID");
  if (ids.length > MAX_ORDERS) throw new SalesError(400, `Choose at most ${MAX_ORDERS} ${noun} at a time.`, "SALES_BULK_INVALID");
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
  const { ids, key } = idsOf(input);
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
  const { ids, key } = idsOf(input);
  const results = [];
  for (const orderId of ids) {
    const done = await step(client, "sales_bulk_invoice", () => createInvoiceFromSalesOrder(client, context, orderId, { idempotencyKey: `${key}:${orderId}` }));
    results.push({ orderId, orderNumber: await numberOf(client, context.organizationId, orderId),
      ...(done.ok ? { invoiceId: done.result.invoiceId, invoiceNumber: done.result.invoiceNumber } : { error: done.error }) });
  }
  return { results, created: results.filter((entry) => entry.invoiceId).length };
}

const invoiceNumberOf = async (client, organizationId, invoiceId) =>
  (await client.query("SELECT invoice_number FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2", [organizationId, invoiceId])).rows[0]?.invoice_number ?? null;

// input: { invoiceIds, idempotencyKey } — each draft is finalised exactly as from its own page (checked again, then into the books).
// options.afterFinal(invoiceId): the IRN step the caller runs after each one (never undoes it). An invoice already final is reported
// as done. Returns { results: [{ invoiceId, invoiceNumber, finalised?, alreadyFinal?, einvoice?, error? }], finalised }.
export async function finaliseInvoicesInBulk(client, context, input = {}, options = {}) {
  const { ids } = idsOf(input, "invoiceIds", "invoices");
  const results = [];
  for (const invoiceId of ids) {
    const done = await step(client, "sales_bulk_finalise", () => postSalesInvoice(client, context, invoiceId, {}));
    const invoiceNumber = await invoiceNumberOf(client, context.organizationId, invoiceId);
    if (!done.ok) { results.push({ invoiceId, invoiceNumber, error: done.error }); continue; }
    const einvoice = !done.result.replayed && options.afterFinal ? await options.afterFinal(invoiceId) : null;
    results.push({ invoiceId, invoiceNumber, finalised: !done.result.replayed, alreadyFinal: Boolean(done.result.replayed), ...(einvoice ? { einvoice } : {}) });
  }
  return { results, finalised: results.filter((entry) => entry.finalised).length };
}

// input: { invoiceIds, idempotencyKey } — each final invoice is emailed with its PDF to the contact on the invoice (else the customer's
// email). options.renderPdf(invoiceId) → { fileName, content }. One without an email address is reported: send it from its page.
// Returns { results: [{ invoiceId, invoiceNumber, sentTo?, error? }], sent }.
export async function sendInvoicesInBulk(client, context, input = {}, options = {}) {
  const { ids, key } = idsOf(input, "invoiceIds", "invoices");
  const results = [];
  for (const invoiceId of ids) {
    const done = await step(client, "sales_bulk_send", async () => {
      const invoice = await loadInvoice(client, context, invoiceId);
      const to = invoice.contact_snapshot?.email ?? invoice.sales_customer_snapshot?.email ?? invoice.customer_snapshot?.email ?? null;
      if (!to) throw new SalesError(400, "No email address for this customer. Send it from the invoice.", "SALES_BULK_NO_EMAIL");
      const pdf = await options.renderPdf(invoiceId);
      return sendSalesInvoice(client, context, invoiceId, { to, idempotencyKey: `${key}:${invoiceId}` }, pdf);
    });
    results.push({ invoiceId, invoiceNumber: await invoiceNumberOf(client, context.organizationId, invoiceId),
      ...(done.ok ? { sentTo: done.result.sentTo } : { error: done.error }) });
  }
  return { results, sent: results.filter((entry) => entry.sentTo).length };
}

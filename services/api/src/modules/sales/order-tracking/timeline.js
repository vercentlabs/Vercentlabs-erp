// The order's timeline: what happened, in order, from the records of each
// module. The order's own history gives its creation, confirmation,
// reservations, dispatches, posted invoices, cancellations and closing;
// receipts, returns, credit notes and refunds are read from their own
// documents. No second history is kept, so the timeline cannot say something
// the documents do not. Edits, notes, files and other audit detail are left
// to the History tab: this is where the order stands, not who typed what.

// The order events that are milestones, and how each reads.
const MILESTONES = Object.freeze({
  "sales_order.created": () => "Order created",
  "sales_order.confirmed": () => "Order confirmed",
  "sales_order.reconfirmed": () => "Order confirmed again",
  "sales_order.reopened": (m) => `Order reopened to draft${m.reason ? `: ${m.reason}` : ""}`,
  "sales_order.stock_reserved": (m) => `Stock reserved${quantities(m.lines)}`,
  "sales_order.stock_released": (m) => `Reserved stock released${quantities(m.lines)}${m.reason ? ` (${m.reason})` : ""}`,
  "sales_order.delivery_dispatched": (m) => `${m.deliveryNumber ?? "Delivery"} dispatched${quantities(m.lines)}`,
  "sales_order.delivery_received": (m) => `${m.deliveryNumber ?? "Delivery"} received by the customer`,
  "sales_order.invoice_posted": (m) => `${m.invoiceNumber ?? "Invoice"} posted`,
  "sales_order.fully_invoiced": () => "Order fully invoiced",
  "sales_order.quantity_cancelled": (m) => `Remaining quantity cancelled${quantities(m.lines)}${m.reason ? `. Reason: ${m.reason}` : ""}`,
  "sales_order.cancelled": (m) => `Order cancelled${m.reason ? `. Reason: ${m.reason}` : ""}`,
  "sales_order.closed": (m) => `Order closed${m.reason ? `: ${m.reason}` : ""}`,
  "sales_order.reopened_for_work": (m) => `Order open again${m.reason ? `: ${m.reason}` : ""}`,
  "sales_order.reopened_closed": (m) => `Closed order reopened${m.reason ? `: ${m.reason}` : ""}`,
});
const number = (value) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
function quantities(lines) {
  if (!Array.isArray(lines) || !lines.length) return "";
  return ` — ${lines.map((line) => `${number(line.quantity ?? 0)}${line.unit ? ` ${line.unit}` : ""} ${line.item ?? ""}`.trim()).join(", ")}`;
}
const KIND = (type) => (type.includes("delivery") ? "delivery" : type.includes("invoice") ? "invoice" : type.includes("stock") ? "reservation" : "order");

// documents: from relatedDocuments() in tracking.js. Returns the events oldest first.
export async function buildOrderTimeline(client, context, order, documents, { canSeeMoney }) {
  const events = (await client.query(
    `SELECT event.id, event.event_type, event.metadata, event.occurred_at, actor.full_name AS actor_name
       FROM tenant.sales_document_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'sales_order' AND event.entity_id = $2 AND event.event_type = ANY($3::text[])
      ORDER BY event.occurred_at, event.id`, [context.organizationId, order.id, Object.keys(MILESTONES)])).rows;
  const timeline = events.map((event) => ({
    id: event.id, at: event.occurred_at, kind: KIND(event.event_type), type: event.event_type, text: MILESTONES[event.event_type](event.metadata ?? {}), actor: event.actor_name ?? null,
    documentId: event.metadata?.deliveryId ?? event.metadata?.invoiceId ?? null,
  }));
  const add = (at, kind, type, text, documentId) => { if (at) timeline.push({ id: `${type}:${documentId}:${new Date(at).getTime()}`, at, kind, type, text, actor: null, documentId }); };
  const amount = (value) => `${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${order.currency_code ?? ""}`.trim();
  for (const invoice of documents.invoices)
    add(invoice.reversed_at, "invoice", "invoice.reversed", `${invoice.number} reversed${invoice.reversal_reason ? `: ${invoice.reversal_reason}` : ""}`, invoice.id);
  if (canSeeMoney)
    for (const receipt of documents.receipts)
      add(receipt.allocated_at, "payment", "receipt.applied", `Receipt ${receipt.number} — ${amount(receipt.amount)} applied to ${receipt.invoice_number}`, receipt.receipt_id);
  for (const entry of documents.returns)
    add(entry.received_at, "return", "return.received", `${entry.number} received — ${number(entry.quantity)} returned`, entry.id);
  for (const credit of documents.creditNotes) {
    add(credit.posted_at, "credit", "credit_note.posted", `${credit.number} posted against ${credit.invoice_number}${canSeeMoney ? ` — ${amount(credit.grand_total)}` : ""}`, credit.id);
    add(credit.reversed_at, "credit", "credit_note.reversed", `${credit.number} reversed`, credit.id);
  }
  for (const refund of documents.refunds) {
    add(refund.posted_at, "refund", "refund.posted", `${refund.number} — ${amount(refund.amount)} refunded from ${refund.credit_note_number}`, refund.id);
    add(refund.reversed_at, "refund", "refund.reversed", `${refund.number} reversed`, refund.id);
  }
  return timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
}

// Field sales on the phone (Sales report Phase 4). What a salesperson on a beat needs in one place, built so the phone can work offline:
//   • the day — today's beats for the salesperson, their retailers (dues, last order to repeat) and the products with list prices, all
//     cached on the phone in one call;
//   • a quick order — saved with the phone's own key, so a sync that runs twice saves it once; free goods the schemes earn are added,
//     and the order is confirmed (an order held for credit stays a draft with the reason);
//   • a collection — cash, cheque or UPI on the spot, also kept once per key, with a receipt to send on WhatsApp;
//   • the day's summary — orders, money collected by method, and retailers seen against the beat.
// Prices shown offline are the list prices; the server works out the real ones (schemes, discounts, tax) when the order arrives.
import { confirmSalesOrder } from "./order-confirmations/confirm.js";
import { createSalesOrder } from "./orders/records.js";
import { recordCustomerPayment } from "./payments/index.js";
import { companyToday } from "./today.js";
import { SalesError, previewSalesDocument } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9:_-]{8,120}$/;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const METHODS = Object.freeze({ cash: "Cash", cheque: "Cheque", upi: "UPI" });

function requireField(context) {
  if (!can(context, "sales.order.create")) throw new SalesError(403, "You do not have permission to take orders.", "PERMISSION_DENIED");
}

// The day on the phone. options: { date? (YYYY-MM-DD), allBeats? (every beat of the salesperson, not only today's) }.
export async function getFieldDay(client, context, options = {}) {
  requireField(context);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(options.date ?? "")) ? options.date : await companyToday(client);
  const beats = (await client.query(
    `SELECT id, code, name, visit_days FROM tenant.sales_routes WHERE organization_id = $1 AND status = 'active' AND salesperson_user_id = $2
        AND ($4 OR extract(isodow FROM $3::date)::smallint = ANY(visit_days)) ORDER BY name`,
    [context.organizationId, context.userId ?? null, date, options.allBeats === true])).rows;
  const ids = beats.map((beat) => beat.id);
  const retailers = ids.length ? (await client.query(
    `SELECT party.id, party.display_name, party.customer_number, party.phone, party.secondary_phone, party.sales_route_id,
            COALESCE((SELECT sum(invoice.outstanding_amount) FROM tenant.accounting_customer_invoices invoice
               WHERE invoice.organization_id = party.organization_id AND invoice.party_id = party.id AND invoice.invoice_type = 'invoice' AND invoice.status NOT IN ('draft', 'cancelled', 'reversed')), 0) AS due,
            (SELECT sales_order.current_version_id FROM tenant.sales_orders sales_order WHERE sales_order.organization_id = party.organization_id AND sales_order.party_id = party.id
               AND sales_order.lifecycle_status IN ('confirmed', 'closed') ORDER BY sales_order.order_date DESC, sales_order.created_at DESC LIMIT 1) AS last_version_id,
            EXISTS (SELECT 1 FROM tenant.sales_orders sales_order WHERE sales_order.organization_id = party.organization_id AND sales_order.party_id = party.id
               AND sales_order.order_date = $3::date AND sales_order.lifecycle_status <> 'cancelled') AS ordered_today
       FROM tenant.business_parties party
      WHERE party.organization_id = $1 AND party.sales_route_id = ANY($2::uuid[]) AND party.status = 'active'
      ORDER BY party.display_name LIMIT 500`, [context.organizationId, ids, date])).rows : [];
  const versions = retailers.map((row) => row.last_version_id).filter(Boolean);
  const lastLines = versions.length ? (await client.query(
    `SELECT sales_order_version_id, item_id, quantity, uom_id FROM tenant.sales_order_lines
      WHERE organization_id = $1 AND sales_order_version_id = ANY($2::uuid[]) AND scheme_rule_id IS NULL AND item_id IS NOT NULL ORDER BY sequence`,
    [context.organizationId, versions])).rows : [];
  // The products: what these retailers bought last, and the rest of what is sold, with the default list's price.
  const products = (await client.query(
    `SELECT item.id, item.code, item.name, item.uom_id, uom.code AS unit, item.mrp,
            (SELECT price.rate FROM tenant.price_list_items price JOIN tenant.price_lists list ON list.id = price.price_list_id
              WHERE price.organization_id = item.organization_id AND price.item_id = item.id AND price.status = 'active' AND list.status = 'active' AND list.is_default
                AND (price.valid_from IS NULL OR price.valid_from <= $2::date) AND (price.valid_to IS NULL OR price.valid_to >= $2::date)
              ORDER BY price.minimum_quantity NULLS FIRST LIMIT 1) AS price
       FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
      WHERE item.organization_id = $1 AND item.status = 'active' AND item.is_sellable AND NOT COALESCE(item.is_variant_template, false)
        AND COALESCE(item.system_role, '') <> 'unlisted'
      ORDER BY (item.id = ANY($3::uuid[])) DESC, item.name LIMIT 1000`,
    [context.organizationId, date, [...new Set(lastLines.map((line) => line.item_id))]])).rows;
  return {
    date, beats: beats.map((beat) => ({ id: beat.id, code: beat.code, name: beat.name })),
    retailers: retailers.map((row) => ({
      id: row.id, name: row.display_name, number: row.customer_number, phone: row.phone ?? row.secondary_phone ?? null, beatId: row.sales_route_id, due: money(row.due),
      orderedToday: row.ordered_today,
      lastOrder: lastLines.filter((line) => line.sales_order_version_id === row.last_version_id).map((line) => ({ itemId: line.item_id, quantity: Number(line.quantity), uomId: line.uom_id })),
    })),
    products: products.map((row) => ({ id: row.id, code: row.code, name: row.name, uomId: row.uom_id, unit: row.unit, price: row.price === null ? null : Number(row.price),
      mrp: row.mrp === null ? null : Number(row.mrp) })),
  };
}

// A quick order from the phone: { partyId, lines: [{ itemId, quantity, uomId? }], idempotencyKey, note?, orderDate? }. Adds the free
// goods the schemes earn, saves and confirms. Returns { orderId, orderNumber, total, confirmed, problems, freeGoods, replayed }.
export async function submitFieldOrder(client, context, input = {}) {
  requireField(context);
  if (!UUID.test(String(input.partyId ?? ""))) throw new SalesError(400, "Choose the retailer.", "SALES_FIELD_INVALID", { field: "partyId" });
  if (!KEY.test(String(input.idempotencyKey ?? ""))) throw new SalesError(400, "The order has no key from the phone.", "SALES_FIELD_INVALID", { field: "idempotencyKey" });
  const lines = (Array.isArray(input.lines) ? input.lines : []).filter((line) => UUID.test(String(line.itemId ?? "")) && Number(line.quantity) > 0)
    .map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity), uomId: UUID.test(String(line.uomId ?? "")) ? line.uomId : undefined }));
  if (!lines.length) throw new SalesError(400, "Add at least one product.", "SALES_FIELD_INVALID", { field: "lines" });
  // An order taken offline keeps the day it was taken, up to a week back.
  const today = await companyToday(client);
  const taken = /^\d{4}-\d{2}-\d{2}$/.test(String(input.orderDate ?? "")) && input.orderDate <= today ? input.orderDate : today;
  const base = { partyId: input.partyId, currencyCode: "INR", orderDate: taken, customerNotes: String(input.note ?? "").trim().slice(0, 1000) || undefined, lines };
  const preview = await previewSalesDocument(client, context, base, { order: true, preview: true, allowMissingPrice: false });
  const freeGoods = (preview.schemes ?? []).filter((scheme) => scheme.earned > scheme.claimed)
    .map((scheme) => ({ itemId: scheme.freeItemId, quantity: scheme.earned - scheme.claimed, uomId: scheme.freeUomId ?? undefined, schemeRuleId: scheme.ruleId, name: scheme.freeItemName }));
  const created = await createSalesOrder(client, context, { ...base, lines: [...lines, ...freeGoods.map(({ name: _name, ...line }) => line)],
    idempotencyKey: `field:${input.idempotencyKey}` });
  const orderId = created.orderId ?? created.id;
  const confirmation = created.replayed ? null : await confirmSalesOrder(client, context, orderId, {});
  const order = (await client.query(
    `SELECT sales_order.sales_order_number, sales_order.lifecycle_status, version.grand_total FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id WHERE sales_order.organization_id = $1 AND sales_order.id = $2`,
    [context.organizationId, orderId])).rows[0];
  return { orderId, orderNumber: order.sales_order_number, total: money(order.grand_total), confirmed: order.lifecycle_status === "confirmed",
    problems: confirmation?.problems ?? [], freeGoods: freeGoods.map((line) => ({ name: line.name, quantity: line.quantity })), replayed: Boolean(created.replayed) };
}

// A collection on the spot: { partyId, amount, method: cash | cheque | upi, chequeNumber?, chequeDate?, draweeBank?, reference?, idempotencyKey }.
// Kept once per key. Returns { receiptNumber, amount, applied, advance, whatsappText, whatsappUrl, replayed } (a post-dated cheque waits on the register).
export async function recordFieldCollection(client, context, input = {}) {
  requireField(context);
  if (!KEY.test(String(input.idempotencyKey ?? ""))) throw new SalesError(400, "The collection has no key from the phone.", "SALES_FIELD_INVALID", { field: "idempotencyKey" });
  if (!METHODS[input.method]) throw new SalesError(400, "Choose cash, cheque or UPI.", "SALES_FIELD_INVALID", { field: "method" });
  const claimed = (await client.query(
    `INSERT INTO tenant.sales_field_collections (organization_id, idempotency_key, party_id, collected_by, collected_on) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
    [context.organizationId, input.idempotencyKey, UUID.test(String(input.partyId ?? "")) ? input.partyId : null, context.userId ?? null, await companyToday(client)])).rows[0];
  if (!claimed) {
    const kept = (await client.query("SELECT result FROM tenant.sales_field_collections WHERE organization_id = $1 AND idempotency_key = $2", [context.organizationId, input.idempotencyKey])).rows[0];
    if (!kept?.result) throw new SalesError(409, "This collection is being saved. Try again in a moment.", "SALES_FIELD_IN_PROGRESS");
    return { ...kept.result, replayed: true };
  }
  const paid = await recordCustomerPayment(client, context, {
    partyId: input.partyId, amount: input.amount, paymentMethod: input.method, chequeNumber: input.chequeNumber, chequeDate: input.chequeDate, draweeBank: input.draweeBank,
    reference: input.reference, notes: "Collected on the beat",
  });
  const party = (await client.query("SELECT display_name, phone, secondary_phone FROM tenant.business_parties WHERE organization_id = $1 AND id = $2", [context.organizationId, input.partyId])).rows[0];
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0];
  const amount = money(input.amount);
  const text = paid.postDated
    ? `${company?.name ?? ""}: we received your cheque ${input.chequeNumber} dated ${input.chequeDate} for ₹${amount.toFixed(2)}. It will be deposited on its date. Thank you.`
    : `${company?.name ?? ""}: received ₹${amount.toFixed(2)} by ${METHODS[input.method].toLowerCase()} from ${party?.display_name ?? "you"}. Receipt ${paid.receiptNumber}. Thank you.`;
  const phone = String(party?.phone ?? party?.secondary_phone ?? "").replace(/\D/g, "");
  const result = { receiptNumber: paid.receiptNumber ?? null, postDated: Boolean(paid.postDated), amount, applied: money(paid.applied), advance: money(paid.advance),
    whatsappText: text, whatsappUrl: `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}` };
  await client.query("UPDATE tenant.sales_field_collections SET result = $2::jsonb, method = $3, amount = $4 WHERE id = $1", [claimed.id, JSON.stringify(result), input.method, amount]);
  return { ...result, replayed: false };
}

// The salesperson's day: { date, orders: { count, total }, collected: { total, byMethod }, retailers: { onBeat, seen } }.
export async function getFieldSummary(client, context, options = {}) {
  requireField(context);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(options.date ?? "")) ? options.date : await companyToday(client);
  const orders = (await client.query(
    `SELECT count(*)::int AS count, COALESCE(sum(version.grand_total), 0) AS total, array_agg(DISTINCT sales_order.party_id) AS parties
       FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.created_by = $2 AND sales_order.order_date = $3::date AND sales_order.lifecycle_status <> 'cancelled'`,
    [context.organizationId, context.userId ?? null, date])).rows[0];
  const collections = (await client.query(
    `SELECT method, count(*)::int AS count, COALESCE(sum(amount), 0) AS total, array_agg(DISTINCT party_id) AS parties FROM tenant.sales_field_collections
      WHERE organization_id = $1 AND collected_by = $2 AND collected_on = $3::date AND result IS NOT NULL GROUP BY method`,
    [context.organizationId, context.userId ?? null, date])).rows;
  const { retailers } = await getFieldDay(client, context, { date });
  const seen = new Set([...(orders.parties ?? []).filter(Boolean), ...collections.flatMap((row) => row.parties ?? [])]);
  return {
    date, orders: { count: orders.count, total: money(orders.total) },
    collected: { total: money(collections.reduce((sum, row) => sum + Number(row.total), 0)),
      byMethod: collections.map((row) => ({ method: row.method, label: METHODS[row.method] ?? row.method, count: row.count, total: money(row.total) })) },
    retailers: { onBeat: retailers.length, seen: retailers.filter((row) => seen.has(row.id)).length },
  };
}

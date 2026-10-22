// What the Delivery Note prints: the delivery as stored (its snapshots),
// its lines and quantities, the shipment details and the delivery
// instructions. Internal notes are never printed. Unit prices are printed
// only when Sales settings say so ("Show prices on delivery note"), and
// never tax or totals: a delivery note is not an invoice.
import { requireDeliveryPermission } from "./access.js";
import { DELIVERY_PERMISSIONS, DELIVERY_STATUS, DeliveryError } from "./constants.js";
import { getDelivery } from "./records.js";

export async function getDeliveryNote(client, context, deliveryId) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.print, "You do not have permission to print delivery notes.");
  const detail = await getDelivery(client, context, deliveryId);
  if (detail.delivery.delivery_status === DELIVERY_STATUS.cancelled)
    throw new DeliveryError(409, "A cancelled delivery has no delivery note.", "SALES_DELIVERY_CANCELLED");
  const showPrices = Boolean((await client.query(`SELECT show_prices_on_delivery_note FROM tenant.sales_settings WHERE organization_id = $1`,
    [context.organizationId])).rows[0]?.show_prices_on_delivery_note);
  const prices = showPrices
    ? new Map((await client.query(
      `SELECT line.id, line.unit_price, btrim(version.currency_code) AS currency_code FROM tenant.sales_order_lines line
         JOIN tenant.sales_order_versions version ON version.organization_id = line.organization_id AND version.id = line.sales_order_version_id
        WHERE line.organization_id = $1 AND line.id = ANY($2::uuid[])`,
      [context.organizationId, detail.lines.map((line) => line.sales_order_line_id)])).rows.map((row) => [row.id, row]))
    : new Map();
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  const batches = await issuedBatches(client, context.organizationId, detail.lines.map((line) => line.id));
  return {
    delivery: detail.delivery,
    lines: detail.lines.map((line) => ({ ...line, unit_price: prices.get(line.sales_order_line_id)?.unit_price ?? null, batches: batches.get(line.id) ?? [] })),
    currency: [...prices.values()][0]?.currency_code ?? null,
    showPrices,
    company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null },
  };
}

// The batches (lots) each delivery line issued, with their expiry (Sales plan: FMCG documents print the batch and expiry, FEFO).
// Map(delivery line id → [{ batchNumber, expiresOn, quantity }]).
export async function issuedBatches(client, organizationId, deliveryLineIds) {
  const ids = [...new Set(deliveryLineIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = (await client.query(
    `SELECT movement.source_line_id, batch.batch_number, batch.expires_on::text AS expires_on, sum(abs(movement.quantity)) AS quantity
       FROM tenant.stock_movements movement JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id
      WHERE movement.organization_id = $1 AND movement.reference_type = 'sales_delivery' AND movement.source_line_id = ANY($2::uuid[]) AND movement.reversed_movement_id IS NULL
      GROUP BY movement.source_line_id, batch.batch_number, batch.expires_on ORDER BY batch.expires_on NULLS LAST, batch.batch_number`, [organizationId, ids])).rows;
  const byLine = new Map();
  for (const row of rows) byLine.set(row.source_line_id, [...(byLine.get(row.source_line_id) ?? []), { batchNumber: row.batch_number, expiresOn: row.expires_on, quantity: Number(row.quantity) }]);
  return byLine;
}

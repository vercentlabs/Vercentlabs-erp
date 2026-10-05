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
  return {
    delivery: detail.delivery,
    lines: detail.lines.map((line) => ({ ...line, unit_price: prices.get(line.sales_order_line_id)?.unit_price ?? null })),
    currency: [...prices.values()][0]?.currency_code ?? null,
    showPrices,
    company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null },
  };
}

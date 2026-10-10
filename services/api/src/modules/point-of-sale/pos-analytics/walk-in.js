// Walk-in and registered sales, from finished sales and returns (never from bills): transactions, gross (before discounts), discounts, tax,
// refunds, net (grand total less refunds) and the average bill — by customer mode, and for walk-in by outlet and payment method. Walk-in
// counts are transactions, never people: the same person buying three times is three walk-in sales.
import { requirePermission, accessiblePosStoreIds } from "../shared/access-control.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getWalkInSalesSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const from = DATE.test(String(input.from ?? "")) ? input.from : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = DATE.test(String(input.to ?? "")) ? input.to : new Date().toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const filters = [];
  const accessible = await accessiblePosStoreIds(client, context);
  if (accessible) { values.push(accessible); filters.push(`sale.store_id = ANY($${values.length}::uuid[])`); }
  if (input.storeId) { values.push(input.storeId); filters.push(`sale.store_id = $${values.length}::uuid`); }
  const where = `sale.organization_id = $1 AND sale.status IN ('completed', 'partially_returned', 'returned') AND sale.sale_date >= $2::date AND sale.sale_date < $3::date + 1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
  const refunds = `COALESCE((SELECT sum(ret.refund_total) FROM tenant.pos_returns ret WHERE ret.organization_id = sale.organization_id AND ret.sale_id = sale.id AND ret.status = 'completed'), 0)`;
  const byMode = (await client.query(
    `SELECT sale.customer_mode AS mode, count(*)::int AS transactions, COALESCE(sum(sale.subtotal), 0)::text AS gross, COALESCE(sum(sale.discount_total), 0)::text AS discounts,
            COALESCE(sum(sale.tax_total), 0)::text AS tax, COALESCE(sum(${refunds}), 0)::text AS refunds, COALESCE(sum(sale.grand_total - ${refunds}), 0)::text AS net,
            COALESCE(avg(sale.grand_total), 0)::numeric(20,2)::text AS average_bill
       FROM tenant.pos_sales sale WHERE ${where} GROUP BY sale.customer_mode`, values)).rows;
  const byOutlet = (await client.query(
    `SELECT store.code, store.name, count(*)::int AS transactions, COALESCE(sum(sale.grand_total - ${refunds}), 0)::text AS net
       FROM tenant.pos_sales sale JOIN tenant.pos_stores store ON store.organization_id = sale.organization_id AND store.id = sale.store_id
      WHERE ${where} AND sale.customer_mode = 'walk_in' GROUP BY store.code, store.name ORDER BY store.code`, values)).rows;
  const byPayment = (await client.query(
    `SELECT payment.payment_method AS method, count(DISTINCT sale.id)::int AS transactions, COALESCE(sum(payment.amount), 0)::text AS amount
       FROM tenant.pos_sales sale JOIN tenant.pos_payments payment ON payment.organization_id = sale.organization_id AND payment.sale_id = sale.id AND payment.status = 'captured'
      WHERE ${where} AND sale.customer_mode = 'walk_in' GROUP BY payment.payment_method ORDER BY payment.payment_method`, values)).rows;
  const empty = { transactions: 0, gross: "0", discounts: "0", tax: "0", refunds: "0", net: "0", averageBill: "0" };
  const pick = (mode) => {
    const row = byMode.find((entry) => entry.mode === mode);
    return row ? { transactions: row.transactions, gross: row.gross, discounts: row.discounts, tax: row.tax, refunds: row.refunds, net: row.net, averageBill: row.average_bill } : empty;
  };
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
  return {
    from, to, currency, walkIn: pick("walk_in"), registered: pick("registered"), walkInByOutlet: byOutlet, walkInByPaymentMethod: byPayment,
    note: "Walk-in figures count transactions, not customers: anonymous purchases cannot be tied to a person.",
  };
}

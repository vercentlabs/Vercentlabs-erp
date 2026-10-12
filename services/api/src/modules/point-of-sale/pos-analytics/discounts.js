// POS discounts realized, from finished sales and completed returns only (never bills in progress), each kind kept apart: automatic
// promotions, cashiers' manual line discounts, order (cart) discounts and coupons. A customer's contracted price list is a price, not a
// discount, so it is not counted here. Who gave which discount (by cashier) is shown only to those who may read POS reports.
import { requirePermission, accessiblePosStoreIds } from "../shared/access-control.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canSeeCashiers = (context) => context.roleSlugs?.includes("organization_owner")
  || ["pos.reports.view", "pos.report.view", "pos.settings.manage"].some((key) => context.permissions?.includes(key));

// input: from, to (default: this month to today), storeId.
export async function getPosDiscountSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const now = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : `${now.toISOString().slice(0, 8)}01`;
  const to = DATE.test(String(input.to ?? "")) ? input.to : now.toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const filters = [];
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); filters.push(`sale.store_id = ANY($${values.length}::uuid[])`); }
  if (UUID.test(String(input.storeId ?? ""))) { values.push(input.storeId); filters.push(`sale.store_id = $${values.length}::uuid`); }
  const sales = `sale.organization_id = $1 AND sale.status IN ('completed', 'partially_returned', 'returned') AND sale.sale_date >= $2::date AND sale.sale_date < $3::date + 1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
  const join = `FROM tenant.pos_sales sale JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id`;
  const amounts = `COALESCE(sum(line.promotion_discount_amount), 0)::text AS automatic, COALESCE(sum(line.manual_discount_amount), 0)::text AS manual,
                   COALESCE(sum(line.cart_discount_amount), 0)::text AS cart, COALESCE(sum(line.coupon_discount_amount), 0)::text AS coupon`;
  const query = async (sql) => (await client.query(sql, values)).rows;

  const [totals] = await query(
    `SELECT ${amounts}, count(DISTINCT sale.id) FILTER (WHERE line.discount_amount > 0)::int AS discounted_sales, count(*) FILTER (WHERE line.discount_amount > 0)::int AS discounted_lines,
            count(*) FILTER (WHERE line.manual_discount_amount > 0)::int AS manual_lines, count(*) FILTER (WHERE line.manual_discount_approval_id IS NOT NULL)::int AS approved_lines,
            COALESCE(sum(line.manual_discount_amount) FILTER (WHERE line.manual_discount_approval_id IS NOT NULL), 0)::text AS approved_amount
       ${join} WHERE ${sales}`);
  const byOutlet = await query(
    `SELECT store.code, store.name, ${amounts} ${join} JOIN tenant.pos_stores store ON store.organization_id = sale.organization_id AND store.id = sale.store_id
      WHERE ${sales} GROUP BY store.code, store.name ORDER BY store.code`);
  const byItem = await query(
    `SELECT item.code, item.name, count(*) FILTER (WHERE line.manual_discount_amount > 0)::int AS manual_lines, ${amounts}
       ${join} JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE ${sales} AND line.discount_amount > 0 GROUP BY item.code, item.name ORDER BY sum(line.discount_amount) DESC LIMIT 20`);
  const byReason = await query(
    `SELECT COALESCE(line.manual_discount_reason_code, 'NOT_RECORDED') AS reason, count(*)::int AS lines, COALESCE(sum(line.manual_discount_amount), 0)::text AS manual
       ${join} WHERE ${sales} AND line.manual_discount_amount > 0 GROUP BY 1 ORDER BY sum(line.manual_discount_amount) DESC`);
  const byCustomer = await query(
    `SELECT sale.customer_id AS id, COALESCE(max(party.display_name), max(sale.customer_name)) AS name, ${amounts}
       ${join} LEFT JOIN tenant.business_parties party ON party.organization_id = sale.organization_id AND party.id = sale.customer_id
      WHERE ${sales} AND sale.customer_id IS NOT NULL AND line.discount_amount > 0 GROUP BY sale.customer_id ORDER BY sum(line.discount_amount) DESC LIMIT 10`);
  const byCashier = canSeeCashiers(context) ? await query(
    `SELECT person.full_name AS name, count(*) FILTER (WHERE line.manual_discount_amount > 0)::int AS manual_lines,
            COALESCE(sum(line.manual_discount_amount), 0)::text AS manual, count(*) FILTER (WHERE line.manual_discount_approval_id IS NOT NULL)::int AS approved_lines
       ${join} JOIN public.users person ON person.id = sale.created_by
      WHERE ${sales} AND line.manual_discount_amount > 0 GROUP BY person.full_name ORDER BY sum(line.manual_discount_amount) DESC`) : null;
  const [returned] = await query(
    `SELECT COALESCE(sum(rl.discount_amount), 0)::text AS discount
       FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
       JOIN tenant.pos_return_lines rl ON rl.organization_id = ret.organization_id AND rl.return_id = ret.id
      WHERE ret.status = 'completed' AND ${sales.replace("sale.status IN ('completed', 'partially_returned', 'returned') AND ", "")}`);
  // Cart Discounts (0091): the bill discount as charged on each sale, and what returns gave back of it.
  const saleOnly = `FROM tenant.pos_sales sale WHERE ${sales} AND sale.cart_discount_amount > 0`;
  const [cartTotals] = await query(
    `SELECT count(*)::int AS sales, COALESCE(sum(sale.cart_discount_amount), 0)::text AS amount, COALESCE(round(avg(sale.cart_discount_amount), 2), 0)::text AS average,
            count(*) FILTER (WHERE sale.cart_discount_approval_id IS NOT NULL)::int AS approved_sales,
            COALESCE(sum(sale.cart_discount_amount) FILTER (WHERE sale.cart_discount_approval_id IS NOT NULL), 0)::text AS approved_amount ${saleOnly}`);
  const cartByReason = await query(`SELECT COALESCE(sale.cart_discount_reason_code, 'NOT_RECORDED') AS reason, count(*)::int AS sales, sum(sale.cart_discount_amount)::text AS amount
      ${saleOnly} GROUP BY 1 ORDER BY sum(sale.cart_discount_amount) DESC`);
  const cartByDate = await query(`SELECT sale.sale_date::text AS date, count(*)::int AS sales, sum(sale.cart_discount_amount)::text AS amount ${saleOnly} GROUP BY 1 ORDER BY 1`);
  const cartByCashier = canSeeCashiers(context) ? await query(
    `SELECT person.full_name AS name, count(*)::int AS sales, sum(sale.cart_discount_amount)::text AS amount, count(*) FILTER (WHERE sale.cart_discount_approval_id IS NOT NULL)::int AS approved_sales
       FROM tenant.pos_sales sale JOIN public.users person ON person.id = sale.created_by WHERE ${sales} AND sale.cart_discount_amount > 0
      GROUP BY person.full_name ORDER BY sum(sale.cart_discount_amount) DESC`) : null;
  const [cartReturned] = await query(
    `SELECT COALESCE(sum(rl.cart_discount_amount), 0)::text AS amount
       FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
       JOIN tenant.pos_return_lines rl ON rl.organization_id = ret.organization_id AND rl.return_id = ret.id
      WHERE ret.status = 'completed' AND ${sales.replace("sale.status IN ('completed', 'partially_returned', 'returned') AND ", "")}`);
  const gross = ["automatic", "manual", "cart", "coupon"].reduce((sum, key) => sum + Number(totals[key]), 0);
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
  return {
    from, to, currency, totals: { ...totals, returned: returned.discount, net: (gross - Number(returned.discount)).toFixed(2) }, byOutlet, byItem, byReason, byCustomer, byCashier,
    cart: {
      totals: { ...cartTotals, returned: cartReturned.amount, net: (Number(cartTotals.amount) - Number(cartReturned.amount)).toFixed(2),
        manual_exposure: (Number(totals.manual) + Number(totals.cart)).toFixed(2) },
      byReason: cartByReason, byDate: cartByDate, byCashier: cartByCashier,
    },
  };
}

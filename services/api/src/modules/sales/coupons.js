// Coupons (Sales report Phase 3): a code worth an amount or a percentage off a quotation or order, with a minimum order value, dates, a
// cap on the discount, and limits on uses in all and per customer. The coupon is taken off after the line discounts and any document
// discount, shared across the lines before tax like a document discount, and kept out of the salesperson's discount limit (the coupon
// was approved when it was set up). A use is an order that carries the code and is not cancelled — a draft order holds its use.
// POS has its own coupons (point-of-sale); these are the Sales ones. Setting coupons up needs the Sales settings permission.
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const invalid = (message, field) => new SalesError(400, message, "SALES_COUPON_INVALID", { field });
const refused = (message) => new SalesError(409, message, "SALES_COUPON_NOT_VALID");
const money = (value) => (value === null || value === undefined || value === "" ? null : Math.round(Number(value) * 100) / 100);
const count = (value) => (value === null || value === undefined || value === "" ? null : Math.trunc(Number(value)));
// A date column comes back as local midnight: read its local parts, not UTC.
const day = (value) => (!value ? null : value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10));
export const normaliseCouponCode = (code) => String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");

const view = (row) => ({
  id: row.id, code: row.code, description: row.description, discountType: row.discount_type, value: Number(row.value),
  maximumDiscount: row.maximum_discount === null ? null : Number(row.maximum_discount), minimumOrder: row.minimum_order === null ? null : Number(row.minimum_order),
  validFrom: day(row.valid_from), validTo: day(row.valid_to), usesTotal: row.uses_total, usesPerCustomer: row.uses_per_customer,
  used: row.used === undefined ? undefined : Number(row.used), active: row.status === "active",
});

function requireSetup(context) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up coupons.", "PERMISSION_DENIED");
}

// The orders that used a coupon: not cancelled, by their current version.
const USES = `SELECT count(DISTINCT sales_order.id)::int FROM tenant.sales_orders sales_order
  JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
 WHERE sales_order.organization_id = coupon.organization_id AND version.coupon_id = coupon.id AND sales_order.lifecycle_status <> 'cancelled'`;

export async function listCoupons(client, context, options = {}) {
  requireSetup(context);
  const rows = (await client.query(`SELECT coupon.*, (${USES}) AS used FROM tenant.sales_coupons coupon
     WHERE coupon.organization_id = $1 AND ($2 OR coupon.status = 'active') ORDER BY coupon.status, coupon.code`,
    [context.organizationId, options.includeInactive === true])).rows;
  return { coupons: rows.map(view) };
}

function readCoupon(input) {
  const code = normaliseCouponCode(input.code);
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw invalid("Enter a code of 3 to 30 letters or digits.", "code");
  const discountType = input.discountType === "amount" ? "amount" : input.discountType === "percent" ? "percent" : null;
  if (!discountType) throw invalid("Choose an amount or a percentage.", "discountType");
  const value = money(input.value);
  if (!(value > 0)) throw invalid("Enter what the coupon is worth.", "value");
  if (discountType === "percent" && value > 100) throw invalid("Enter a percentage up to 100.", "value");
  const validFrom = day(input.validFrom);
  const validTo = day(input.validTo);
  if (validFrom && validTo && validTo < validFrom) throw invalid("The end date is before the start date.", "validTo");
  const usesTotal = count(input.usesTotal);
  const usesPerCustomer = count(input.usesPerCustomer);
  if ((usesTotal !== null && usesTotal < 1) || (usesPerCustomer !== null && usesPerCustomer < 1)) throw invalid("Enter at least 1 use, or leave it empty for no limit.", "usesTotal");
  const maximumDiscount = discountType === "percent" ? money(input.maximumDiscount) : null;
  const minimumOrder = money(input.minimumOrder);
  if ((maximumDiscount !== null && maximumDiscount <= 0) || (minimumOrder !== null && minimumOrder < 0)) throw invalid("Enter a positive amount.", "maximumDiscount");
  return [code, String(input.description ?? "").trim().slice(0, 200) || null, discountType, value, maximumDiscount, minimumOrder, validFrom, validTo, usesTotal, usesPerCustomer];
}

export async function saveCoupon(client, context, input = {}, couponId = null) {
  requireSetup(context);
  const values = readCoupon(input);
  const clash = (await client.query("SELECT id FROM tenant.sales_coupons WHERE organization_id = $1 AND code = $2 AND ($3::uuid IS NULL OR id <> $3)",
    [context.organizationId, values[0], couponId && UUID.test(String(couponId)) ? couponId : null])).rows[0];
  if (clash) throw new SalesError(409, `A coupon with the code ${values[0]} already exists.`, "SALES_COUPON_DUPLICATE", { field: "code" });
  const row = couponId
    ? (await client.query(`UPDATE tenant.sales_coupons SET code = $3, description = $4, discount_type = $5, value = $6, maximum_discount = $7, minimum_order = $8,
          valid_from = $9, valid_to = $10, uses_total = $11, uses_per_customer = $12, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [context.organizationId, UUID.test(String(couponId)) ? couponId : null, ...values])).rows[0]
    : (await client.query(`INSERT INTO tenant.sales_coupons (organization_id, code, description, discount_type, value, maximum_discount, minimum_order, valid_from, valid_to,
          uses_total, uses_per_customer, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [context.organizationId, ...values, context.userId ?? null])).rows[0];
  if (!row) throw new SalesError(404, "Coupon not found.", "SALES_COUPON_NOT_FOUND");
  return { coupon: view(row) };
}

export async function setCouponActive(client, context, couponId, active) {
  requireSetup(context);
  const row = (await client.query("UPDATE tenant.sales_coupons SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *",
    [context.organizationId, UUID.test(String(couponId ?? "")) ? couponId : null, active ? "active" : "inactive"])).rows[0];
  if (!row) throw new SalesError(404, "Coupon not found.", "SALES_COUPON_NOT_FOUND");
  return { coupon: view(row) };
}

// What a coupon takes off a document: { coupon, amount } or null without a code. value is the goods' value after line and document
// discounts. partyId is the customer; orderId the order being saved (its own use is not counted against it). carried: the coupon comes
// from the quotation the order is made from, so its dates are not checked again.
export async function couponDiscount(client, context, code, { value, partyId, documentDate, orderId = null, carried = false }) {
  const wanted = normaliseCouponCode(code);
  if (!wanted) return null;
  const coupon = (await client.query("SELECT * FROM tenant.sales_coupons WHERE organization_id = $1 AND code = $2", [context.organizationId, wanted])).rows[0];
  if (!coupon || coupon.status !== "active") throw refused(`The coupon ${wanted} does not exist or is switched off.`);
  const today = day(documentDate) ?? new Date().toISOString().slice(0, 10);
  if (!carried && coupon.valid_from && today < day(coupon.valid_from)) throw refused(`The coupon ${wanted} starts on ${day(coupon.valid_from)}.`);
  if (!carried && coupon.valid_to && today > day(coupon.valid_to)) throw refused(`The coupon ${wanted} ended on ${day(coupon.valid_to)}.`);
  if (coupon.minimum_order !== null && Number(value) < Number(coupon.minimum_order))
    throw refused(`The coupon ${wanted} needs an order of at least ${Number(coupon.minimum_order).toFixed(2)}.`);
  if (coupon.uses_total !== null || coupon.uses_per_customer !== null) {
    const uses = (await client.query(`SELECT count(DISTINCT sales_order.id)::int AS total, count(DISTINCT sales_order.id) FILTER (WHERE sales_order.party_id = $3)::int AS customer
        FROM tenant.sales_orders sales_order
        JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       WHERE sales_order.organization_id = $1 AND version.coupon_id = $2 AND sales_order.lifecycle_status <> 'cancelled' AND ($4::uuid IS NULL OR sales_order.id <> $4)`,
      [context.organizationId, coupon.id, partyId ?? null, orderId])).rows[0];
    if (coupon.uses_total !== null && uses.total >= coupon.uses_total) throw refused(`The coupon ${wanted} has been used up.`);
    if (coupon.uses_per_customer !== null && uses.customer >= coupon.uses_per_customer) throw refused(`This customer has already used the coupon ${wanted}.`);
  }
  let amount = coupon.discount_type === "amount" ? Number(coupon.value) : (Number(value) * Number(coupon.value)) / 100;
  if (coupon.maximum_discount !== null) amount = Math.min(amount, Number(coupon.maximum_discount));
  amount = Math.max(0, Math.min(amount, Number(value)));
  return { coupon: view(coupon), amount: Math.round(amount * 100) / 100 };
}

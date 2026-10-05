import { SalesError } from "./index.js";
import { assertSalesCreditAdjustmentAllowed } from "./after-sales.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value, label = "Amount") => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new SalesError(400, `${label} must be greater than zero.`, "SALES_AMOUNT_INVALID");
  return n;
};
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new SalesError(400, `${label} is invalid.`, "SALES_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const can = (c, permission) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission);
const need = (c, permission) => { if (!can(c, permission)) throw new SalesError(403, "You do not have permission to perform this Sales operation."); };
async function organizationUser(client, c, userId, label = "Salesperson") {
  const id = uuid(userId, label);
  const result = await client.query(
    `SELECT users.id,users.full_name
       FROM public.organization_memberships membership
       JOIN public.users users ON users.id=membership.user_id
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND membership.status='active' AND users.status='active'
      LIMIT 1`,
    [c.organizationId, id],
  );
  if (!result.rows[0])
    throw new SalesError(409, `${label} must be an active organisation member.`, "SALES_USER_SCOPE_INVALID");
  return result.rows[0];
}
async function order(client, c, id, { lock = false } = {}) {
  const values = [c.organizationId, uuid(id, "Sales order")];
  const result = await client.query(
    `SELECT record.*,version.currency_code,version.grand_total,version.margin_amount,version.subtotal
       FROM tenant.sales_orders record
       JOIN tenant.sales_order_versions version ON version.organization_id=record.organization_id AND version.id=record.current_version_id
      WHERE record.organization_id=$1 AND record.id=$2 LIMIT 1${lock ? " FOR UPDATE OF record" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new SalesError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  return result.rows[0];
}

export async function listSalesPass1Operations(client, c, { kind = "adjustments", limit = 100 } = {}) {
  need(c, "sales.view");
  const tables = {
    adjustments: "sales_credit_adjustment_requests",
    "pricing-rules": "sales_pricing_rules",
  };
  const table = tables[kind];
  if (!table) throw new SalesError(404, "Unknown Sales operation resource.");
  const { rows } = await client.query(`SELECT * FROM tenant.${table} record WHERE record.organization_id=$1 ORDER BY record.created_at DESC LIMIT $2`, [c.organizationId, Math.min(Math.max(Number(limit) || 100, 1), 250)]);
  return rows;
}

export async function requestSalesCreditAdjustment(client, c, input = {}) {
  need(c, "sales.invoice.request");
  const target = await order(client, c, input.salesOrderId);
  const type = String(input.adjustmentType || "").toLowerCase();
  if (!new Set(["credit_note", "refund"]).has(type)) throw new SalesError(400, "Adjustment type must be credit_note or refund.", "SALES_ADJUSTMENT_TYPE_INVALID");
  const amount = money(input.amount);
  if (amount > Number(target.grand_total) + 0.000001) throw new SalesError(409, "Adjustment cannot exceed the Sales order total.", "SALES_ADJUSTMENT_EXCEEDS_ORDER");
  const reason = text(input.reason, 2000);
  if (!reason) throw new SalesError(400, "Adjustment reason is required.", "SALES_ADJUSTMENT_REASON_REQUIRED");
  await assertSalesCreditAdjustmentAllowed(client, c, target, { type, amount, returnRequestId: input.returnRequestId ? uuid(input.returnRequestId, "Return request") : null });
  const result = await client.query(`INSERT INTO tenant.sales_credit_adjustment_requests(organization_id,sales_order_id,return_request_id,adjustment_type,amount,currency_code,reason,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [c.organizationId,target.id,input.returnRequestId ? uuid(input.returnRequestId,"Return request") : null,type,amount,target.currency_code,reason,c.userId]);
  return result.rows[0];
}

export async function accrueSalesCommission(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const target = await order(client, c, input.salesOrderId);
  if (!["confirmed", "closed"].includes(target.lifecycle_status))
    throw new SalesError(409, "Commission accrues only on confirmed orders.", "SALES_COMMISSION_ORDER_NOT_CONFIRMED");
  const ownerUserId = input.ownerUserId
    ? (await organizationUser(client, c, input.ownerUserId)).id
    : target.owner_user_id
      ? (await organizationUser(client, c, target.owner_user_id)).id
      : null;
  if (!ownerUserId)
    throw new SalesError(409, "Select a salesperson before accruing commission.", "SALES_COMMISSION_OWNER_REQUIRED");
  const found = input.ruleId
    ? await client.query(`SELECT * FROM tenant.sales_commission_rules WHERE organization_id=$1 AND id=$2 AND status='active'`, [c.organizationId,uuid(input.ruleId,"Commission rule")])
    : await client.query(`SELECT * FROM tenant.sales_commission_rules WHERE organization_id=$1 AND status='active' AND (owner_user_id IS NULL OR owner_user_id=$2) AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY owner_user_id NULLS LAST,created_at DESC LIMIT 1`, [c.organizationId,ownerUserId]);
  const rule = found.rows[0]; if (!rule) throw new SalesError(409, "No active commission rule applies to this order.", "SALES_COMMISSION_RULE_REQUIRED");
  const basisAmount = rule.basis === "gross_margin" ? Number(target.margin_amount) : Number(target.subtotal);
  const commission = Math.round((basisAmount * Number(rule.rate_percent) / 100) * 1e6) / 1e6;
  const explanation = {
    orderNumber: target.sales_order_number,
    rule: rule.name,
    basis: rule.basis,
    basisLabel: rule.basis === "gross_margin" ? "order margin" : "order net sales (before tax)",
    basisAmount,
    ratePercent: Number(rule.rate_percent),
    commission,
    formula: `${basisAmount} × ${Number(rule.rate_percent)}% = ${commission}`,
  };
  const result = await client.query(`INSERT INTO tenant.sales_commission_entries(organization_id,sales_order_id,rule_id,owner_user_id,basis_amount,rate_percent,commission_amount,explanation,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$9::jsonb,$8,$8) ON CONFLICT(organization_id,sales_order_id,owner_user_id,rule_id) DO UPDATE SET basis_amount=EXCLUDED.basis_amount,rate_percent=EXCLUDED.rate_percent,commission_amount=EXCLUDED.commission_amount,explanation=EXCLUDED.explanation,updated_by=EXCLUDED.updated_by,updated_at=now() WHERE tenant.sales_commission_entries.status='accrued' RETURNING *`, [c.organizationId,target.id,rule.id,ownerUserId,basisAmount,rule.rate_percent,commission,c.userId,JSON.stringify(explanation)]);
  if (!result.rows[0]) throw new SalesError(409, "This commission is already approved, paid or reversed and can't be recalculated.", "SALES_COMMISSION_LOCKED");
  return result.rows[0];
}

export async function listSalesPass1Options(client, c) {
  need(c, "sales.view");
  const orders = await client.query(
    `SELECT record.id,record.sales_order_number,record.owner_user_id,record.lifecycle_status,record.current_version_id,
            version.currency_code,version.grand_total
       FROM tenant.sales_orders record
       JOIN tenant.sales_order_versions version ON version.organization_id=record.organization_id AND version.id=record.current_version_id
      WHERE record.organization_id=$1 AND record.lifecycle_status NOT IN ('cancelled')
      ORDER BY record.updated_at DESC LIMIT 100`, [c.organizationId]);
  const lines = orders.rows.length ? await client.query(
    `SELECT line.id,line.sales_order_version_id,line.item_name_snapshot,line.item_code_snapshot,line.quantity
       FROM tenant.sales_order_lines line
      WHERE line.organization_id=$1 AND line.sales_order_version_id=ANY($2::uuid[])
      ORDER BY line.sales_order_version_id,line.sequence`, [c.organizationId, orders.rows.map((row)=>row.current_version_id)]) : { rows: [] };
  const rules = await client.query(
    `SELECT record.id,record.name,record.owner_user_id,record.rate_percent,record.basis FROM tenant.sales_commission_rules record WHERE record.organization_id=$1 AND record.status='active' ORDER BY record.name LIMIT 100`, [c.organizationId]);
  const [priceLists, items, customers, uoms, users, suppliers] = await Promise.all([
    client.query(`SELECT id,code,name,currency_code FROM tenant.price_lists WHERE organization_id=$1 AND price_list_type='sales' AND status='active' ORDER BY name LIMIT 200`, [c.organizationId]),
    client.query(`SELECT id,code,name,uom_id FROM tenant.items WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 500`, [c.organizationId]),
    client.query(`SELECT id,code,display_name FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','both') ORDER BY display_name LIMIT 500`, [c.organizationId]),
    client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`, [c.organizationId]),
    client.query(
      `SELECT users.id,users.full_name AS name
         FROM public.organization_memberships membership
         JOIN public.users users ON users.id=membership.user_id
        WHERE membership.organization_id=$1 AND membership.status='active' AND users.status='active'
        ORDER BY users.full_name LIMIT 500`,
      [c.organizationId],
    ),
    client.query(`SELECT id,code,display_name FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('supplier','both') ORDER BY display_name LIMIT 500`, [c.organizationId]),
  ]);
  return { orders: orders.rows, lines: lines.rows, commissionRules: rules.rows, priceLists: priceLists.rows, items: items.rows, customers: customers.rows, uoms: uoms.rows, users: users.rows, suppliers: suppliers.rows };
}

// ---- Sales settings (approval thresholds, margin floor, defaults) ----------------
const SETTINGS_DEFAULTS = Object.freeze({
  default_price_list_id: null,
  default_payment_term_id: null,
  default_quote_validity_days: 15,
  quotation_approval_amount: 0,
  quotation_approval_discount: 10,
  minimum_margin_percent: 0,
  allow_direct_orders: true,
  invoice_quantity_basis: "ordered",
  reserve_stock_on_confirm: true,
  require_customer_po: false,
  require_requested_delivery_date: false,
  check_availability_on_confirm: true,
  show_prices_on_delivery_note: false,
  default_quotation_terms: null,
  allow_line_discounts: true,
  allow_document_discounts: true,
  allow_percent_discounts: true,
  allow_amount_discounts: true,
  // Empty: a reason is never required / there is no limit.
  discount_reason_above_percent: null,
  discount_limit_percent: null,
  discount_limit_elevated_percent: null,
});
const DISCOUNT_SETTINGS = Object.freeze({
  allowLineDiscounts: "allow_line_discounts", allowDocumentDiscounts: "allow_document_discounts", allowPercentDiscounts: "allow_percent_discounts",
  allowAmountDiscounts: "allow_amount_discounts", discountReasonAbovePercent: "discount_reason_above_percent", discountLimitPercent: "discount_limit_percent",
  discountLimitElevatedPercent: "discount_limit_elevated_percent",
});

export async function getSalesSettings(client, c) {
  need(c, "sales.view");
  const result = await client.query("SELECT * FROM tenant.sales_settings WHERE organization_id=$1", [c.organizationId]);
  return { ...SETTINGS_DEFAULTS, ...(result.rows[0] || {}), configured: Boolean(result.rows[0]) };
}

function boundedNumber(value, label, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new SalesError(400, `${label} must be between ${min} and ${max}.`, "SALES_SETTINGS_INVALID");
  return n;
}

export async function updateSalesSettings(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const current = await getSalesSettings(client, c);
  const next = { ...current };
  if (input.defaultQuoteValidityDays !== undefined) next.default_quote_validity_days = Math.trunc(boundedNumber(input.defaultQuoteValidityDays, "Default quotation validity (days)", { min: 1, max: 365 }));
  if (input.quotationApprovalAmount !== undefined) next.quotation_approval_amount = boundedNumber(input.quotationApprovalAmount, "Quotation approval amount", { min: 0, max: 1e12 });
  if (input.quotationApprovalDiscount !== undefined) next.quotation_approval_discount = boundedNumber(input.quotationApprovalDiscount, "Quotation approval discount %", { min: 0, max: 100 });
  if (input.minimumMarginPercent !== undefined) next.minimum_margin_percent = boundedNumber(input.minimumMarginPercent, "Minimum margin %", { min: -100, max: 100 });
  if (input.allowDirectOrders !== undefined) next.allow_direct_orders = Boolean(input.allowDirectOrders);
  // Reserve the stock available when an order is confirmed.
  if (input.reserveStockOnConfirm !== undefined) next.reserve_stock_on_confirm = Boolean(input.reserveStockOnConfirm);
  // What must be on an order before it is confirmed.
  if (input.requireCustomerPo !== undefined) next.require_customer_po = Boolean(input.requireCustomerPo);
  if (input.requireRequestedDeliveryDate !== undefined) next.require_requested_delivery_date = Boolean(input.requireRequestedDeliveryDate);
  if (input.checkAvailabilityOnConfirm !== undefined) next.check_availability_on_confirm = Boolean(input.checkAvailabilityOnConfirm);
  // Unit prices on the Delivery Note (never tax or totals).
  if (input.showPricesOnDeliveryNote !== undefined) next.show_prices_on_delivery_note = Boolean(input.showPricesOnDeliveryNote);
  // Pricing & Discounts: which discounts are allowed, when a reason is needed and how much a user may give.
  const discountKeys = Object.keys(DISCOUNT_SETTINGS).filter((key) => input[key] !== undefined);
  if (discountKeys.length) {
    need(c, "sales.discount.manage_settings");
    for (const key of discountKeys) {
      const column = DISCOUNT_SETTINGS[key];
      if (column.startsWith("allow_")) next[column] = Boolean(input[key]);
      else next[column] = input[key] === null || input[key] === "" ? null : boundedNumber(input[key], "A discount percentage", { min: 0, max: 100 });
    }
    if (!next.allow_percent_discounts && !next.allow_amount_discounts)
      throw new SalesError(400, "Allow at least one discount type: percentage or fixed amount.", "SALES_SETTINGS_INVALID");
    if (next.discount_limit_percent != null && next.discount_limit_elevated_percent != null && Number(next.discount_limit_elevated_percent) < Number(next.discount_limit_percent))
      throw new SalesError(400, "The manager limit cannot be lower than the salesperson limit.", "SALES_SETTINGS_INVALID");
  }
  // Copied onto each new quotation, where it can be changed.
  if (input.defaultQuotationTerms !== undefined) next.default_quotation_terms = text(input.defaultQuotationTerms, 20000) || null;
  if (input.invoiceQuantityBasis !== undefined) {
    if (!["ordered", "fulfilled"].includes(input.invoiceQuantityBasis)) throw new SalesError(400, "Invoice quantity basis is invalid.", "SALES_SETTINGS_INVALID");
    next.invoice_quantity_basis = input.invoiceQuantityBasis;
  }
  const columns = ["default_quote_validity_days","quotation_approval_amount","quotation_approval_discount","minimum_margin_percent","allow_direct_orders","reserve_stock_on_confirm","require_customer_po","require_requested_delivery_date","check_availability_on_confirm","show_prices_on_delivery_note","invoice_quantity_basis","default_price_list_id","default_quotation_terms","allow_line_discounts","allow_document_discounts","allow_percent_discounts","allow_amount_discounts","discount_reason_above_percent","discount_limit_percent","discount_limit_elevated_percent"];
  const result = await client.query(
    `INSERT INTO tenant.sales_settings(organization_id,${columns.join(",")},created_by,updated_by)
     VALUES($1,${columns.map((_, index) => `$${index + 3}`).join(",")},$2,$2)
     ON CONFLICT (organization_id) DO UPDATE SET ${columns.map((column) => `${column}=EXCLUDED.${column}`).join(",")},updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [c.organizationId, c.userId, ...columns.map((column) => next[column] ?? null)],
  );
  return { ...SETTINGS_DEFAULTS, ...result.rows[0], configured: true };
}

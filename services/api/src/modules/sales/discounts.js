// Discounts on a sales document, used by the one pricing calculation
// (previewSalesDocument) that quotations, sales orders and their previews
// share. There are two levels, each a percentage or a fixed amount:
//
//   line discount      on one product or service line
//   document discount  on the whole document, shared across the lines in
//                      proportion to their value after line discounts
//
// The order is fixed:
//   quantity × unit price = gross → − line discount = net
//   → − document discount share = taxable value → tax → line total
//
// Amounts are always calculated here from the entered type and value; a
// discount amount sent by a client is never used. A price override and a
// discount are different things and both are kept on the line: the list
// price, the unit price actually charged, and the discount off that price.
import { SalesError } from "./index.js";
import { add, decimal, div, formatDecimal, mul, percent, roundMoney, sub } from "./money.js";

export const DISCOUNT_PERMISSIONS = Object.freeze({
  applyLine: "sales.discount.apply",
  applyDocument: "sales.discount.apply_document",
  aboveLimit: "sales.discount.apply_above_limit",
  overrideLimit: "sales.discount.override_limit",
  manageSettings: "sales.discount.manage_settings",
});

export const DISCOUNT_REASONS = Object.freeze([
  { code: "volume", label: "Volume" },
  { code: "negotiation", label: "Negotiation" },
  { code: "competitive_match", label: "Competitive match" },
  { code: "existing_customer", label: "Existing customer" },
  { code: "management_decision", label: "Management decision" },
  { code: "launch_offer", label: "Launch offer" },
  { code: "other", label: "Other" },
]);

const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const text = (value, maximum) => {
  const result = value == null ? "" : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
const shown = (value) => formatDecimal(value).replace(/\.?0+$/, "") || "0";

// The document discount as entered ({ documentDiscountType, documentDiscountValue })
// and its amount for these line values. nets: each line's value after its line discount.
export function readDocumentDiscount(context, master, input, nets, options = {}) {
  const type = input.documentDiscountType === "amount" ? "amount" : "percent";
  const value = decimal(input.documentDiscountValue || 0);
  const eligible = nets.reduce((total, net) => add(total, net), decimal(0));
  if (value < 0n) throw new SalesError(400, "The document discount cannot be negative.", "SALES_DISCOUNT_INVALID");
  if (value === 0n) return { type, value, amount: decimal(0), percent: decimal(0) };
  if (!options.carryQuotedPrices) {
    if (!can(context, DISCOUNT_PERMISSIONS.applyDocument))
      throw new SalesError(403, "You do not have permission to give a document discount.", "SALES_DISCOUNT_FORBIDDEN");
    if (master.settings.allow_document_discounts === false)
      throw new SalesError(409, "Document discounts are switched off in Sales settings.", "SALES_DISCOUNT_NOT_ALLOWED");
    if (master.settings[type === "amount" ? "allow_amount_discounts" : "allow_percent_discounts"] === false)
      throw new SalesError(409, `${type === "amount" ? "Fixed amount" : "Percentage"} discounts are switched off in Sales settings.`, "SALES_DISCOUNT_NOT_ALLOWED");
  }
  let amount;
  if (type === "percent") {
    if (value > decimal(100)) throw new SalesError(400, "The document discount must be between 0 and 100%.", "SALES_DISCOUNT_INVALID");
    amount = roundMoney(percent(eligible, value), master.currency.decimal_places);
  } else {
    amount = roundMoney(value, master.currency.decimal_places);
    if (amount > eligible)
      throw new SalesError(400, "The document discount is more than the value of the lines.", "SALES_DISCOUNT_INVALID");
  }
  return { type, value, amount, percent: eligible > 0n ? div(mul(amount, 100), eligible) : decimal(0) };
}

// Shares `amount` across the lines in proportion to their value. The shares
// add up to the amount exactly: the last line with a value takes what
// rounding left over. No share is more than its line.
export function allocateDocumentDiscount(amount, nets, decimalPlaces) {
  const shares = nets.map(() => decimal(0));
  const eligible = nets.reduce((total, net) => add(total, net), decimal(0));
  if (amount <= 0n || eligible <= 0n) return shares;
  const last = nets.reduce((found, net, index) => (net > 0n ? index : found), -1);
  let allocated = decimal(0);
  nets.forEach((net, index) => {
    if (net <= 0n) return;
    let share = index === last ? sub(amount, allocated) : roundMoney(div(mul(amount, net), eligible), decimalPlaces);
    if (share > net) share = net;
    if (share < 0n) share = decimal(0);
    shares[index] = share;
    allocated = add(allocated, share);
  });
  return shares;
}

// The limit a user may discount up to, from Sales settings: none for those
// who may override it, the higher limit for managers, else the standard one.
function limitFor(context, settings) {
  if (can(context, DISCOUNT_PERMISSIONS.overrideLimit)) return null;
  const standard = settings.discount_limit_percent;
  const elevated = settings.discount_limit_elevated_percent;
  if (can(context, DISCOUNT_PERMISSIONS.aboveLimit)) return elevated == null ? null : decimal(elevated);
  return standard == null ? null : decimal(standard);
}

// The rules a discount must pass once the lines are calculated: the user's
// limit and the reason required above the tenant's threshold. The discount
// measured is each line's total discount (its own plus its share of the
// document discount) as a percentage of its gross amount.
//
// A preview (options.preview) reports problems instead of refusing, so the
// totals stay on screen while the user is still typing. A document carried
// from a quotation (options.carryQuotedPrices) was checked when it was quoted.
export function checkDiscountRules(context, master, input, lines, options = {}) {
  const reasonCode = text(input.discountReasonCode, 40);
  const reasonText = text(input.discountReasonText, 1000);
  if (reasonCode && !DISCOUNT_REASONS.some((reason) => reason.code === reasonCode))
    throw new SalesError(400, "Choose a discount reason from the list.", "SALES_DISCOUNT_REASON_INVALID");
  let requested = decimal(0);
  let line = null;
  for (const entry of lines) {
    // A line carried from a quotation was checked when it was quoted.
    if (entry.quoted) continue;
    const effective = decimal(entry.effectiveDiscountPercent);
    if (effective > requested) { requested = effective; line = entry.sequence; }
  }
  const result = {
    requestedPercent: formatDecimal(requested), limitPercent: null, limitExceeded: false, limitOverridden: false, reasonRequired: false,
    reasonCode: requested > 0n ? reasonCode : null, reasonText: requested > 0n ? reasonText : null, message: null,
  };
  if (options.carryQuotedPrices || requested === 0n) return result;
  const settings = master.settings;
  const limit = limitFor(context, settings);
  result.limitPercent = limit == null ? null : formatDecimal(limit);
  // Two decimals of slack: a fixed amount rarely lands on an exact percentage.
  const over = (bound) => roundMoney(requested, 2) > bound;
  if (limit != null && over(limit)) {
    result.limitExceeded = true;
    result.message = `You are authorized to apply discounts up to ${shown(limit)}%. Requested: ${shown(roundMoney(requested, 2))}%${lines.length > 1 ? ` (line ${line})` : ""}.`;
    if (!options.preview) throw new SalesError(403, result.message, "SALES_DISCOUNT_LIMIT_EXCEEDED");
  }
  // Allowed only because this user has a higher limit than the standard one.
  result.limitOverridden = settings.discount_limit_percent != null && over(decimal(settings.discount_limit_percent)) && !result.limitExceeded;
  const threshold = settings.discount_reason_above_percent;
  if (threshold != null && over(decimal(threshold))) {
    result.reasonRequired = true;
    const given = reasonCode === "other" ? reasonText : reasonCode || reasonText;
    if (!given) {
      const message = reasonCode === "other" ? "Describe the reason for the discount." : `Give the reason for a discount above ${shown(decimal(threshold))}%.`;
      result.message ??= message;
      if (!options.preview) throw new SalesError(422, message, "SALES_DISCOUNT_REASON_REQUIRED");
    }
  }
  return result;
}

// What changed in the discounts between two saved versions of a document,
// for its audit trail. before/after: { documentDiscount: { type, value, amount }, lines: [{ sequence, name, listPrice, unitPrice, override, type, value, amount }] }
export function discountChanges(before, after) {
  const changes = [];
  const label = (discount) => (Number(discount.amount) ? (discount.type === "amount" ? `${Number(discount.value)}` : `${Number(discount.value)}%`) : "none");
  const compare = (scope, was, now) => {
    const from = label(was), to = label(now);
    if (from === to) return;
    changes.push({ scope, event: from === "none" ? "discount_added" : to === "none" ? "discount_removed" : "discount_changed", from, to });
  };
  compare("document", before?.documentDiscount ?? { amount: 0 }, after.documentDiscount);
  const earlier = new Map((before?.lines ?? []).map((line) => [`${line.itemId}:${line.sequence}`, line]));
  for (const line of after.lines) {
    const was = earlier.get(`${line.itemId}:${line.sequence}`);
    compare(`line ${line.sequence}: ${line.name}`, was ?? { amount: 0 }, line);
    if (line.override && (!was || !was.override || Number(was.unitPrice) !== Number(line.unitPrice)))
      changes.push({ scope: `line ${line.sequence}: ${line.name}`, event: "price_overridden", from: String(Number(was?.unitPrice ?? line.listPrice)), to: String(Number(line.unitPrice)) });
  }
  return changes;
}

// What a document form needs to offer discounts: what is allowed, what this
// user may do, their limit and when a reason is needed.
export async function discountOptions(client, context) {
  const settings = (await client.query(
    `SELECT allow_line_discounts, allow_document_discounts, allow_percent_discounts, allow_amount_discounts, discount_reason_above_percent, discount_limit_percent,
            discount_limit_elevated_percent
       FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0] ?? {};
  const limit = limitFor(context, settings);
  return {
    allowLine: settings.allow_line_discounts !== false,
    allowDocument: settings.allow_document_discounts !== false,
    allowPercent: settings.allow_percent_discounts !== false,
    allowAmount: settings.allow_amount_discounts !== false,
    canApplyLine: can(context, DISCOUNT_PERMISSIONS.applyLine),
    canApplyDocument: can(context, DISCOUNT_PERMISSIONS.applyDocument),
    limitPercent: limit == null ? null : Number(formatDecimal(limit)),
    reasonAbovePercent: settings.discount_reason_above_percent == null ? null : Number(settings.discount_reason_above_percent),
    reasons: DISCOUNT_REASONS,
  };
}

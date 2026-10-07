// Supplier Debit Notes & Vendor Credits: shared names, permissions, statuses and small readers.
//
//   debit note to supplier (claim)   the buyer's commercial claim (SDN-…): drafted, issued, answered by the supplier, resolved by a credit or
//                                    closed. No accounting, tax or payable effect.
//   vendor credit                    the financial credit (VC-…): Finance's credit_note vendor document — draft, posted through Finance,
//                                    cancelled while a draft, reversed only by a controlled reversal. What happens to it after posting
//                                    (applied to bills, refunded) is its settlement, a separate dimension.
import { decimal, formatDecimal } from "../../../core/decimal.js";
import { PurchaseOrderError, dayOf, fail, has, isUuid, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { poCan } from "../purchase-orders/access.js";

export { PurchaseOrderError as VendorCreditError, dayOf, fail, has, isUuid, optionalUuid, readDate, requireUuid, text, poCan };

export const VC_PERMISSIONS = Object.freeze({
  claimsView: "procurement.claims.view",
  claimsManage: "procurement.claims.manage",
  claimsRespond: "procurement.claims.respond",
  creditsManage: "procurement.credits.manage",
  creditsExceptional: "procurement.credits.exceptional",
  billsView: "procurement.bills.view",
  payablesManage: "accounting.payables.manage",
  payablesApprove: "accounting.payables.approve",
  payments: "accounting.payments.manage",
  financeView: "accounting.view",
});

// Why the buyer claims, or why the supplier credits: one reason per line.
export const CREDIT_REASONS = Object.freeze([
  { code: "returned_goods", label: "Returned goods" }, { code: "overbilling", label: "Overbilling / excess quantity billed" },
  { code: "price_difference", label: "Price difference" }, { code: "short_supply", label: "Short supply" }, { code: "damaged_goods", label: "Damaged goods" },
  { code: "quality_deficiency", label: "Quality deficiency" }, { code: "deficient_service", label: "Deficient service" }, { code: "discount_not_applied", label: "Discount not applied" },
  { code: "tax_correction", label: "Tax correction" }, { code: "commercial_settlement", label: "Commercial settlement" }, { code: "other", label: "Other" },
]);
export const REASON_LABELS = Object.freeze(Object.fromEntries(CREDIT_REASONS.map((entry) => [entry.code, entry.label])));
export const readReason = (value, field = "reason") => {
  const code = String(value ?? "").trim();
  if (!REASON_LABELS[code]) fail("Choose the reason.", field, "VENDOR_CREDIT_REASON_REQUIRED");
  return code;
};

export const CREDIT_ORIGINS = Object.freeze([
  { code: "supplier_credit_note", label: "Supplier credit note received" }, { code: "accepted_claim", label: "Accepted debit claim" },
  { code: "other_authorized", label: "Other authorised basis (on account)" },
]);
export const ORIGIN_LABELS = Object.freeze(Object.fromEntries(CREDIT_ORIGINS.map((entry) => [entry.code, entry.label])));
export const TAX_TREATMENTS = Object.freeze([
  { code: "gst_adjusting", label: "GST-adjusting credit (tax reduced proportionally)" }, { code: "financial_only", label: "Financial / commercial credit only (no tax)" },
]);
export const TAX_TREATMENT_LABELS = Object.freeze(Object.fromEntries(TAX_TREATMENTS.map((entry) => [entry.code, entry.label])));

export const CLAIM_STATUS_LABELS = Object.freeze({ draft: "Draft", issued: "Issued", accepted: "Accepted", partially_accepted: "Partially accepted", rejected: "Rejected",
  resolved: "Resolved", closed: "Closed" });
export const CREDIT_STATUS_LABELS = Object.freeze({ draft: "Draft", awaiting_approval: "Awaiting approval", posted: "Posted", cancelled: "Cancelled", reversed: "Reversed" });
export const SETTLEMENT_LABELS = Object.freeze({ not_applicable: "—", unapplied: "Unapplied", partially_applied: "Partially applied", fully_settled: "Fully settled" });

// Two kinds of document in one workspace: the buyer's debit claims, and the vendor credits actually recognised.
export const VC_VIEWS = Object.freeze([
  { key: "all", label: "All" },
  { key: "claims", label: "Debit Claims", group: "claims" }, { key: "claims_draft", label: "Draft", group: "claims" }, { key: "claims_issued", label: "Issued", group: "claims" },
  { key: "awaiting_response", label: "Awaiting Supplier Response", group: "claims" }, { key: "accepted_open", label: "Accepted / Partially Accepted", group: "claims" },
  { key: "claims_closed", label: "Rejected / Resolved / Closed", group: "claims" },
  { key: "credits", label: "Vendor Credits", group: "credits" }, { key: "credit_drafts", label: "Draft", group: "credits" }, { key: "credits_posted", label: "Posted", group: "credits" },
  { key: "unapplied", label: "Unapplied", group: "credits" }, { key: "partially_applied", label: "Partially Applied", group: "credits" }, { key: "settled", label: "Fully Settled", group: "credits" },
  { key: "cancelled_reversed", label: "Cancelled / Reversed", group: "credits" },
]);

const POSTED = ["posted", "partially_paid", "paid", "overdue", "disputed"];
export const POSTED_STATUSES = POSTED;
export const POSTED_SQL = "('posted', 'partially_paid', 'paid', 'overdue', 'disputed')";
// A credit that counts against what a bill line, return line or claim may still be credited: anything not cancelled or reversed.
export const LIVE_SQL = "NOT IN ('cancelled', 'reversed')";

export function creditStatus(row) {
  if (row.status === "pending_approval" || row.status === "approved") return "awaiting_approval";
  if (POSTED.includes(row.status)) return "posted";
  return row.status;
}
// Unapplied / Partially applied / Fully settled: what bills and refunds took of a posted credit.
export function settlementStatus(row) {
  if (!POSTED.includes(row.status)) return "not_applicable";
  const outstanding = decimal(row.outstanding_amount);
  if (outstanding <= 0n) return "fully_settled";
  return outstanding < decimal(row.grand_total) ? "partially_applied" : "unapplied";
}

// What is left of an accepted claim after GST rounding of a scaled credit (a few paise) counts as credited.
export const CLAIM_ROUNDING = 50000n; // 0.05 at scale 6
export const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const AMOUNT = /^\d+(?:\.\d{1,6})?$/;
export function readAmount(value, label, field, code = "VENDOR_CREDIT_AMOUNT_INVALID") {
  const raw = String(value ?? "").trim();
  if (!AMOUNT.test(raw) || decimal(raw) <= 0n) fail(`${label} must be greater than zero.`, field, code);
  return decimal(raw);
}
// The supplier's credit note number as compared for duplicates: no whitespace or separators, case-folded.
export const normalizedNumber = (value) => String(value ?? "").replace(/[\s\-_/.]+/g, "").toUpperCase();

export const can = poCan;
export function requireAny(context, permissions, message) {
  if (!permissions.some((permission) => poCan(context, permission))) throw new PurchaseOrderError(403, message, "PERMISSION_DENIED");
}
export const requireClaimView = (context) => requireAny(context, [VC_PERMISSIONS.claimsView, VC_PERMISSIONS.claimsManage, VC_PERMISSIONS.payablesManage],
  "You do not have permission to view debit notes to suppliers.");
export const requireCreditView = (context) => requireAny(context, [VC_PERMISSIONS.billsView, VC_PERMISSIONS.creditsManage, VC_PERMISSIONS.payablesManage, VC_PERMISSIONS.payablesApprove,
  VC_PERMISSIONS.creditsExceptional, VC_PERMISSIONS.claimsView],
  "You do not have permission to view vendor credits.");
// Finance reads back what it wrote; a draft is recorded in Finance's document by whoever may prepare credits (posting stays with Accounts Payable).
export const fin = (context) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), VC_PERMISSIONS.financeView])] });
export const drafting = (context) => ({ ...fin(context), permissions: [...new Set([...fin(context).permissions, VC_PERMISSIONS.payablesManage])] });
export const settling = (context) => ({ ...fin(context), permissions: [...new Set([...fin(context).permissions, VC_PERMISSIONS.payments])] });

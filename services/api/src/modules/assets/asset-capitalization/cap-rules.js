// Assets — Purchase and Capitalization, the rules: permissions, the request, CWIP and adjustment states, cost components, and the
// errors. Registration, capitalization and commissioning are three separate events; buying an asset never capitalizes it, and
// capitalizing it never starts its depreciation on the purchase date.
import { AssetError, has } from "../common.js";

export const CAP = Object.freeze({
  view: "assets.acquisition.view", register: "assets.acquisition.register", bulkRegister: "assets.acquisition.bulk_register", allocate: "assets.acquisition.allocate_cost",
  viewCost: "assets.acquisition.view_cost", request: "assets.capitalization.request", review: "assets.capitalization.review", approve: "assets.capitalization.approve",
  post: "assets.capitalization.post", adjust: "assets.capitalization.adjust", cwip: "assets.cwip.manage", reconcile: "assets.acquisition.reconcile", export: "assets.acquisition.export",
  audit: "assets.acquisition.view_audit",
});
export const seesAcquisitions = (c) => Object.values(CAP).some((k) => has(c, k));
export const seesCost = (c) => has(c, CAP.viewCost) || has(c, CAP.approve) || has(c, CAP.post) || has(c, CAP.allocate);

export const CAP_STATUS = Object.freeze({ DRAFT: "Draft", PENDING_REVIEW: "Waiting for Finance", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved — to post", POSTING: "Posting",
  POSTED: "Posted", REJECTED: "Rejected", REVERSED: "Reversed", RECOVERY_REQUIRED: "Posting being verified" });
export const TREATMENT = Object.freeze({ CAPITALIZE: "Capitalize as a fixed asset", CWIP: "Capital work in progress", TRACKED_EXPENSED: "Expense (tracked only)", NOT_ELIGIBLE: "Not eligible" });
export const COMPONENT = Object.freeze({ PURCHASE_PRICE: "Purchase price", FREIGHT: "Freight", INSTALLATION: "Installation", TESTING: "Testing and commissioning", OTHER_DIRECT: "Other directly attributable cost",
  DISCOUNT: "Discount", NONRECOVERABLE_TAX: "Nonrecoverable tax", CWIP_TRANSFER: "From capital work in progress", CREDIT_NOTE: "Supplier credit", ADDITIONAL_COST: "Additional cost", CORRECTION: "Correction" });
export const ALLOCATABLE = Object.freeze(["PURCHASE_PRICE", "FREIGHT", "INSTALLATION", "TESTING", "OTHER_DIRECT", "NONRECOVERABLE_TAX", "DISCOUNT"]);
export const CWIP_STATUS = Object.freeze({ OPEN: "Accumulating cost", READY: "Ready for use — to transfer", TRANSFERRED: "Transferred to assets", CANCELLED: "Cancelled" });
export const ADJUSTMENT_KIND = Object.freeze({ CREDIT_NOTE: "Supplier credit note", ADDITIONAL_COST: "Additional cost", CORRECTION: "Correction" });
export const ADJUSTMENT_STATUS = Object.freeze({ PENDING_REVIEW: "Waiting for Finance", POSTED: "Posted", REJECTED: "Rejected" });
// A supplier bill posted to the ledger: only then is there an amount in an account to reclassify.
export const POSTED_BILL = Object.freeze(["posted", "partially_paid", "paid", "overdue", "disputed"]);
export const LIVE = Object.freeze(["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "POSTING", "RECOVERY_REQUIRED"]);

const MESSAGES = Object.freeze({
  ASSET_ACQUISITION_SOURCE_INVALID: "Select a valid purchase or Finance source.",
  ASSET_ACQUISITION_NOT_RECEIVED: "The required goods receipt has not been confirmed.",
  ASSET_ACQUISITION_QUANTITY_EXCEEDED: "The selected quantity exceeds the units available for registration.",
  ASSET_ACQUISITION_ALREADY_ALLOCATED: "This acquisition cost has already been fully allocated.",
  ASSET_ACQUISITION_COST_PENDING: "Finance has not yet confirmed the acquisition cost.",
  ASSET_CAPITALIZATION_NOT_ELIGIBLE: "This purchase does not meet the applicable capitalization requirements.",
  ASSET_CAPITALIZATION_TAX_REVIEW: "Finance must verify the purchase tax treatment.",
  ASSET_CAPITALIZATION_GL_MAPPING_MISSING: "Configure the required Finance account mapping.",
  ASSET_CAPITALIZATION_APPROVAL_REQUIRED: "Finance approval is required before capitalization.",
  ASSET_CAPITALIZATION_ALREADY_POSTED: "This capitalization has already been recorded.",
  ASSET_CWIP_NOT_READY: "The asset has not yet been confirmed ready for use.",
  ASSET_CAPITALIZATION_PERIOD_CLOSED: "The accounting period is closed. Use an authorized adjustment.",
  ASSET_CAPITALIZATION_COMPANY_MISMATCH: "The purchase belongs to another Company.",
  ASSET_CAPITALIZATION_PERMISSION_DENIED: "You are not authorized to perform this action.",
  ASSET_CAPITALIZATION_VERSION_CONFLICT: "The acquisition details changed. Refresh and review.",
  ASSET_CAPITALIZATION_RECOVERY_REQUIRED: "The accounting outcome is being verified. Do not submit it again.",
  ASSET_CAPITALIZATION_NOT_FOUND: "This capitalization is not available.",
  ASSET_CAPITALIZATION_INVALID: "Check the details and try again.",
});
export const CAP_MESSAGES = MESSAGES;
export const capError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireCap = (c, key) => { if (!has(c, key)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED"); };
export const requireAnyCap = (c, keys) => { if (!keys.some((k) => has(c, k))) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED"); };
// A guard trigger's refusal ("ASSET_ACQUISITION_ALREADY_ALLOCATED: …") as the error it names.
export function fromDb(failure) {
  const m = /^(ASSET_[A-Z_]+): (.*)$/.exec(String(failure?.message ?? ""));
  if (failure?.code === "23514" && m) return capError(409, m[1], `${MESSAGES[m[1]] ?? ""} ${m[2]}`.trim());
  return failure;
}
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
export const toCents = (v) => BigInt(Math.round(Number(v ?? 0) * 100));
export const centsText = (cents) => `${cents < 0n ? "-" : ""}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, "0")}`;
// Splits an amount in cents deterministically: by weights (equal when none), the rounding remainder to the last share.
export function split(totalCents, weights) {
  const w = weights.map((x) => (x > 0n ? x : 0n));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return w.map(() => 0n);
  const shares = w.map((x) => (totalCents * x) / sum);
  const rest = totalCents - shares.reduce((a, b) => a + b, 0n);
  shares[shares.length - 1] += rest;
  return shares;
}

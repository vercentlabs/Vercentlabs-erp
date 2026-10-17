// Assets — Purchase Invoice-to-Asset Creation, the rules: permissions, the outcomes of a registration, and the errors. A supplier invoice
// can start asset registration; it never creates another purchase, payable, tax posting or capitalization.
import { AssetError, has } from "../common.js";

export const INV = Object.freeze({
  view: "assets.invoice.view_source", create: "assets.invoice.create", bulk: "assets.invoice.bulk_create", viewCost: "assets.invoice.view_cost", reconcile: "assets.invoice.reconcile",
  history: "assets.invoice.view_history", export: "assets.invoice.export",
});
export const seesInvoices = (c) => Object.values(INV).some((k) => has(c, k)) || has(c, "assets.acquisition.view");
export const seesInvoiceCost = (c) => has(c, INV.viewCost) || has(c, "assets.acquisition.view_cost") || has(c, "assets.capitalization.approve");
// An invoice that Finance has approved or posted; draft, pending, cancelled and reversed invoices cannot create assets.
export const ELIGIBLE_BILL = Object.freeze(["approved", "posted", "partially_paid", "paid", "overdue", "disputed"]);
export const BATCH_STATUS = Object.freeze({ PROCESSING: "Processing", COMPLETED: "Completed", PARTIAL: "Partly completed", FAILED: "Nothing registered", RECOVERY_REQUIRED: "Being checked" });
export const OUTCOME = Object.freeze({ REGISTERED_COST_PENDING: "Registered — cost pending", REGISTERED_CAPITALIZATION_PENDING: "Registered — with Finance for capitalization",
  REGISTERED_CAPITALIZATION_CONFIRMED: "Registered — capitalized", TRACKED_ONLY: "Registered — tracked only (expensed)" });

const MESSAGES = Object.freeze({
  ASSET_INVOICE_NOT_ELIGIBLE: "This invoice cannot currently be used to create assets.",
  ASSET_INVOICE_LINE_NOT_ELIGIBLE: "This line is not eligible for asset registration.",
  ASSET_INVOICE_NOT_RECEIVED: "Confirm the required receipt before registering these assets.",
  ASSET_INVOICE_QUANTITY_EXCEEDED: "The requested number exceeds the remaining eligible quantity.",
  ASSET_INVOICE_ALREADY_REGISTERED: "These items have already been registered as assets.",
  ASSET_INVOICE_SERIAL_DUPLICATE: "Review an existing asset with the same serial number.",
  ASSET_INVOICE_CATEGORY_INVALID: "Select a valid Asset Category.",
  ASSET_INVOICE_COST_UNAVAILABLE: "The purchase cost has not yet been confirmed.",
  ASSET_INVOICE_COMPANY_MISMATCH: "The invoice belongs to another Company.",
  ASSET_INVOICE_SOURCE_CHANGED: "The invoice or receipt changed. Review the registration again.",
  ASSET_INVOICE_PARTIAL_COMPLETION: "Some assets were created. Review the remaining items.",
  ASSET_INVOICE_PERMISSION_DENIED: "You cannot create assets from this invoice.",
  ASSET_INVOICE_VERSION_CONFLICT: "The invoice registration changed. Refresh and review.",
  ASSET_INVOICE_OUTCOME_UNKNOWN: "Checking the prior registration. Do not submit it again.",
  ASSET_INVOICE_INVALID: "Check the details and try again.",
});
export const INVOICE_MESSAGES = MESSAGES;
export const invError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireInvoiceView = (c) => { if (!seesInvoices(c)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);

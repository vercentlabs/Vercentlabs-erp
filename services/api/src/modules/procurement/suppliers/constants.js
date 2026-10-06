// The vocabulary of the Supplier Master.
//
// A supplier is the procurement role of one organization identity (the
// shared party). The role owns what Procurement decides about a supplier:
// its number, type, category, whether it may be used, and the defaults new
// purchase documents start from. Procurement documents keep their own
// snapshot of those defaults; the master never rewrites a document.

export class SupplierError extends Error {
  constructor(status, message, code = "SUPPLIER_ERROR", details = undefined) {
    super(message);
    this.name = "SupplierError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const SUPPLIER_PERMISSIONS = Object.freeze({
  view: "procurement.suppliers.view",
  viewAll: "procurement.suppliers.view_all",
  create: "procurement.suppliers.create",
  edit: "procurement.suppliers.edit",
  status: "procurement.suppliers.status",
  block: "procurement.suppliers.block",
  addresses: "procurement.suppliers.addresses",
  contacts: "procurement.suppliers.contacts",
  commercial: "procurement.suppliers.commercial",
  tax: "procurement.suppliers.tax",
  import: "procurement.suppliers.import",
  export: "procurement.suppliers.export",
  payablesView: "procurement.suppliers.payables.view",
  paymentDetailsView: "accounting.supplier_payment_details.view",
  paymentDetailsManage: "accounting.supplier_payment_details.manage",
  createPurchaseOrder: "procurement.po.create",
});

// Active: used for RFQs and purchase orders. Inactive: not for new business,
// history untouched. Blocked: a commercial or compliance hold, with a reason.
export const SUPPLIER_STATUS = Object.freeze({ active: "active", inactive: "inactive", blocked: "blocked" });
export const SUPPLIER_STATUS_LABELS = Object.freeze({ active: "Active", inactive: "Inactive", blocked: "Blocked" });

export const SUPPLIER_TYPES = Object.freeze([
  { code: "business", label: "Business" },
  { code: "individual", label: "Individual" },
]);

// For search, filters and reports only: a category never drives approvals or accounting.
export const SUPPLIER_CATEGORIES = Object.freeze([
  { code: "raw_materials", label: "Raw Materials" },
  { code: "finished_goods", label: "Finished Goods" },
  { code: "services", label: "Services" },
  { code: "contractor", label: "Contractor" },
  { code: "logistics", label: "Logistics" },
  { code: "maintenance", label: "Maintenance" },
  { code: "utilities", label: "Utilities" },
  { code: "other", label: "Other" },
]);

export const SUPPLIER_ADDRESS_TYPES = Object.freeze([
  { code: "registered", label: "Registered" },
  { code: "billing", label: "Billing" },
  { code: "ordering", label: "Ordering" },
  { code: "dispatch", label: "Dispatch / Ship From" },
  { code: "branch", label: "Branch" },
  { code: "other", label: "Other" },
]);

export const SUPPLIER_CONTACT_ROLES = Object.freeze([
  { code: "sales", label: "Sales" },
  { code: "quotation", label: "Quotation" },
  { code: "procurement", label: "Procurement" },
  { code: "accounts", label: "Accounts / Billing" },
  { code: "dispatch", label: "Dispatch" },
  { code: "technical", label: "Technical" },
  { code: "management", label: "Management" },
  { code: "other", label: "Other" },
]);

export const GST_REGISTRATION_TYPES = Object.freeze([
  { code: "registered_regular", label: "Registered – Regular", needsGstin: true },
  { code: "registered_composition", label: "Registered – Composition", needsGstin: true },
  { code: "sez", label: "SEZ", needsGstin: true },
  { code: "deemed_export", label: "Deemed Export", needsGstin: false },
  { code: "unregistered", label: "Unregistered", needsGstin: false },
  { code: "overseas", label: "Overseas", needsGstin: false },
]);

export const SUPPLIER_VIEWS = Object.freeze([
  { key: "all", label: "All Suppliers" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "blocked", label: "Blocked" },
  { key: "mine", label: "My Suppliers" },
]);

const label = (list) => (code) => list.find((entry) => entry.code === code)?.label ?? code ?? null;
export const supplierCategoryLabel = label(SUPPLIER_CATEGORIES);
export const supplierTypeLabel = label(SUPPLIER_TYPES);
export const supplierAddressTypeLabel = label(SUPPLIER_ADDRESS_TYPES);
export const supplierContactRoleLabel = label(SUPPLIER_CONTACT_ROLES);
export const gstRegistrationLabel = label(GST_REGISTRATION_TYPES);

export const SUPPLIER_NUMBER_DOCUMENT_TYPE = "supplier";
export const PARTY_CODE_DOCUMENT_TYPE = "business_party";
export const CONTACT_NUMBER_DOCUMENT_TYPE = "crm_contact";
export const SUPPLIER_FILE_ENTITY = "procurement.supplier";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label) {
  if (!isUuid(value)) throw new SupplierError(400, `${label} is invalid.`, "SUPPLIER_INVALID_ID");
  return String(value);
}
export const text = (value, max = 2000) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
export const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

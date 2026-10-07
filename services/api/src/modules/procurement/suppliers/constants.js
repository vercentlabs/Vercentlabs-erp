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
  addressesView: "procurement.suppliers.addresses.view",
  addressesDeactivate: "procurement.suppliers.addresses.deactivate",
  contacts: "procurement.suppliers.contacts",
  contactsView: "procurement.suppliers.contacts.view",
  contactsDeactivate: "procurement.suppliers.contacts.deactivate",
  defaults: "procurement.suppliers.defaults",
  commercial: "procurement.suppliers.commercial",
  tax: "procurement.suppliers.tax",
  import: "procurement.suppliers.import",
  export: "procurement.suppliers.export",
  payablesView: "procurement.suppliers.payables.view",
  paymentDetailsView: "accounting.supplier_payment_details.view",
  paymentDetailsManage: "accounting.supplier_payment_details.manage",
  createPurchaseOrder: "procurement.po.create",
  createBill: "procurement.bills.create",
  managePayables: "accounting.payables.manage",
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

// What a supplier location is used for. One place may serve several purposes (a head office that is the registered,
// ordering and billing address); each purpose has at most one default location.
export const SUPPLIER_ADDRESS_PURPOSES = Object.freeze([
  { code: "registered", label: "Registered / Legal", defaultColumn: "registered_address_id" },
  { code: "ordering", label: "Ordering / Correspondence", defaultColumn: "ordering_address_id" },
  { code: "billing", label: "Billing / Invoice", defaultColumn: "billing_address_id" },
  { code: "ship_from", label: "Ship From / Dispatch", defaultColumn: "ship_from_address_id" },
  { code: "branch", label: "Branch / Plant", defaultColumn: null },
  { code: "return_to", label: "Return To", defaultColumn: "return_to_address_id" },
  { code: "other", label: "Other", defaultColumn: null },
]);
// The old one-type-per-row column keeps a value only because its NOT NULL check cannot be removed.
export const LEGACY_ADDRESS_TYPE = Object.freeze({ registered: "registered", ordering: "ordering", billing: "billing", ship_from: "dispatch", branch: "branch", return_to: "other", other: "other" });

// What a person does for you at the supplier. One person may hold several roles.
export const SUPPLIER_CONTACT_ROLES = Object.freeze([
  { code: "sales", label: "Sales / Quotation" },
  { code: "procurement", label: "Procurement / Orders" },
  { code: "accounts", label: "Accounts / Billing" },
  { code: "dispatch", label: "Dispatch / Logistics" },
  { code: "technical", label: "Technical" },
  { code: "management", label: "Management" },
  { code: "other", label: "Other" },
]);
// The person a document is addressed to by default, one per purpose. Primary is the fallback when no specific one is set.
export const SUPPLIER_CONTACT_PURPOSES = Object.freeze([
  { code: "primary", label: "Primary contact", defaultColumn: "primary_contact_id" },
  { code: "rfq", label: "RFQ contact", defaultColumn: "rfq_contact_id" },
  { code: "ordering", label: "Ordering contact", defaultColumn: "ordering_contact_id" },
  { code: "accounts", label: "Accounts contact", defaultColumn: "accounts_contact_id" },
  { code: "dispatch", label: "Dispatch contact", defaultColumn: "dispatch_contact_id" },
]);

// A GST registration is one of the registered types; a location without one trades unregistered (or overseas).
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
export const supplierAddressPurposeLabel = label(SUPPLIER_ADDRESS_PURPOSES);
export const supplierContactPurposeLabel = label(SUPPLIER_CONTACT_PURPOSES);
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

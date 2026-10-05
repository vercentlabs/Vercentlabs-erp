// The fixed vocabulary of the Customer Master.
export class CustomerError extends Error {
  constructor(status, message, code = "SALES_CUSTOMER_ERROR", details = undefined) {
    super(message);
    this.name = "CustomerError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const CUSTOMER_PERMISSIONS = Object.freeze({
  view: "sales.customers.view",
  viewTeam: "sales.customers.view_team",
  viewAll: "sales.customers.view_all",
  create: "sales.customers.create",
  edit: "sales.customers.edit",
  inactivate: "sales.customers.inactivate",
  reactivate: "sales.customers.reactivate",
  block: "sales.customers.block",
  unblock: "sales.customers.unblock",
  delete: "sales.customers.delete",
  import: "sales.customers.import",
  export: "sales.customers.export",
  manageAddresses: "sales.customers.manage_addresses",
  manageContacts: "sales.customers.manage_contacts",
  linkAccount: "sales.customers.link_account",
  editGstin: "sales.customers.edit_gstin",
  changeCurrency: "sales.customers.change_currency",
  changePaymentTerms: "sales.customers.change_payment_terms",
  changePriceList: "sales.customers.change_price_list",
  viewFinancials: "sales.customers.view_financials",
  viewAddresses: "sales.customers.addresses.view",
  inactivateAddress: "sales.customers.addresses.inactivate",
  setDefaultBilling: "sales.customers.addresses.set_default_billing",
  setDefaultShipping: "sales.customers.addresses.set_default_shipping",
  editAddressGstin: "sales.customers.addresses.edit_gstin",
  viewContacts: "sales.customers.contacts.view",
  inactivateContact: "sales.customers.contacts.inactivate",
  setPrimaryContact: "sales.customers.contacts.set_primary",
});

export const CUSTOMER_NUMBER_DOCUMENT_TYPE = "customer";
export const ACCOUNT_NUMBER_DOCUMENT_TYPE = "business_party";

export const CUSTOMER_KINDS = Object.freeze([
  { code: "business", label: "Business" },
  { code: "individual", label: "Individual" },
]);

// Active / Inactive is the record's status; Blocked is an active customer
// that may not receive new sales documents.
export const CUSTOMER_STATUSES = Object.freeze([
  { code: "active", label: "Active" },
  { code: "inactive", label: "Inactive" },
  { code: "blocked", label: "Blocked" },
]);

export const GST_REGISTRATION_TYPES = Object.freeze([
  { code: "registered_regular", label: "Registered – Regular", needsGstin: true },
  { code: "registered_composition", label: "Registered – Composition", needsGstin: true },
  { code: "sez", label: "SEZ", needsGstin: true },
  { code: "deemed_export", label: "Deemed Export", needsGstin: false },
  { code: "unregistered", label: "Unregistered", needsGstin: false },
  { code: "consumer", label: "Consumer", needsGstin: false },
  { code: "overseas", label: "Overseas", needsGstin: false },
]);

export const CUSTOMER_ADDRESS_TYPES = Object.freeze([
  { code: "registered", label: "Registered" },
  { code: "billing", label: "Billing" },
  { code: "shipping", label: "Shipping" },
  { code: "office", label: "Branch / Office" },
  { code: "other", label: "Other" },
]);

export const CUSTOMER_CONTACT_ROLES = Object.freeze([
  { code: "procurement", label: "Procurement" },
  { code: "finance", label: "Finance" },
  { code: "billing", label: "Billing" },
  { code: "shipping", label: "Shipping / Warehouse" },
  { code: "operations", label: "Operations" },
  { code: "technical", label: "Technical" },
  { code: "decision_maker", label: "Decision Maker" },
  { code: "other", label: "Other" },
]);

export const CUSTOMER_VIEWS = Object.freeze([
  { key: "all", label: "All Customers" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "blocked", label: "Blocked" },
  { key: "recently_created", label: "Recently Created" },
  { key: "with_outstanding", label: "With Outstanding", finance: true },
  { key: "with_overdue", label: "With Overdue", finance: true },
]);

// Indian GST state codes come from the shared tax layer.
export { GST_STATES, gstStateCode, gstStateName } from "../../../core/tax/constants.js";

// The customers of the organization: parties Sales transacts with.
export const CUSTOMER_PARTY_SQL = (alias) => `(${alias}.customer_number IS NOT NULL OR ${alias}.party_type IN ('customer', 'both'))`;

const label = (list) => { const map = new Map(list.map((entry) => [entry.code, entry.label])); return (code) => map.get(code) ?? code ?? null; };
export const customerKindLabel = label(CUSTOMER_KINDS);
export const customerStatusLabel = label(CUSTOMER_STATUSES);
export const gstRegistrationLabel = label(GST_REGISTRATION_TYPES);
export const addressTypeLabel = label([...CUSTOMER_ADDRESS_TYPES, { code: "plant", label: "Plant" }]);

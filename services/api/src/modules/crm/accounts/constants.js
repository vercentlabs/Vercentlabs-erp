// The fixed vocabulary of an account. Type answers "what is our relationship
// with this company?"; status answers "is the record in use?". Selling
// progress belongs to opportunity stages, not to the account.
export const ACCOUNT_TYPES = Object.freeze([
  { code: "prospect", label: "Prospect" },
  { code: "customer", label: "Customer" },
  { code: "partner", label: "Partner" },
  { code: "other", label: "Other" },
]);

export const ACCOUNT_STATUSES = Object.freeze([
  { code: "active", label: "Active" },
  { code: "inactive", label: "Inactive" },
  { code: "archived", label: "Archived" },
]);

export const EMPLOYEE_RANGES = Object.freeze(["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"]);

export const ADDRESS_TYPES = Object.freeze([
  { code: "registered", label: "Registered" },
  { code: "billing", label: "Billing" },
  { code: "shipping", label: "Shipping" },
  { code: "office", label: "Office / Branch" },
  { code: "other", label: "Other" },
]);

export const ACCOUNT_ACTIVITY_TYPES = Object.freeze([
  { code: "call", label: "Call" },
  { code: "email", label: "Email" },
  { code: "meeting", label: "Meeting" },
  { code: "other", label: "General activity" },
]);

export const ACCOUNT_FOLLOW_UP_TYPES = Object.freeze(["call", "email", "meeting", "task", "other"]);

export const ACCOUNT_PERMISSIONS = Object.freeze({
  view: "crm.accounts.view",
  viewAll: "crm.accounts.view_all",
  viewSensitive: "crm.accounts.view_sensitive",
  create: "crm.accounts.create",
  edit: "crm.accounts.edit",
  archive: "crm.accounts.archive",
  delete: "crm.accounts.delete",
  assign: "crm.accounts.assign",
  reassign: "crm.accounts.reassign",
  merge: "crm.accounts.merge",
  import: "crm.accounts.import",
  export: "crm.accounts.export",
  createCustomer: "crm.accounts.create_customer",
});

export const ACCOUNT_NUMBER_DOCUMENT_TYPE = "business_party";
export const CUSTOMER_NUMBER_DOCUMENT_TYPE = "customer";

// Business parties that are only suppliers belong to Procurement, not CRM.
export const CRM_ACCOUNT_PARTY_SQL = (alias) => `${alias}.party_type <> 'supplier'`;

const labels = (list) => new Map(list.map((entry) => [entry.code, entry.label]));
const TYPE_LABELS = labels(ACCOUNT_TYPES);
const STATUS_LABELS = labels(ACCOUNT_STATUSES);
export const accountTypeLabel = (code) => TYPE_LABELS.get(code) ?? code;
export const accountStatusLabel = (code) => STATUS_LABELS.get(code) ?? code;

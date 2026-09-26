// Field-level security registry: the audited list of sensitive fields in the
// twelve business modules, the permission that reveals/changes them, where the
// rule is enforced, and what every output channel does with them. It is a
// VERIFICATION catalogue (scripts/validation/verify-field-security.mjs and
// tests/integration/production/field-security-db.test.mjs check it against the
// code), not runtime configuration: enforcement stays in each module.
//
// Evidence rule: a field is listed only where the repository already treats it
// as sensitive (an existing permission and projection). Nothing is invented.
//
// Channel values:
//   projected       the channel is served by the module's own read, which hides
//                   the fields without the permission
//   gated           the whole channel requires the permission
//   excluded        the channel has an explicit allow-list without the fields
//   not-exposed     the channel carries no data of this resource
//   structural      the sensitive value is never stored (see `note`)

const CHANNELS = Object.freeze(["detail", "list", "search", "report", "export", "document", "apiV1", "jobs", "events", "automation", "attachments"]);

const channels = (overrides = {}) => {
  const base = { detail: "projected", list: "projected", search: "excluded", report: "not-exposed", export: "not-exposed", document: "not-exposed", apiV1: "not-exposed", jobs: "not-exposed", events: "excluded", automation: "excluded", attachments: "not-exposed" };
  return Object.freeze({ ...base, ...overrides });
};

export const FIELD_SECURITY = Object.freeze([
  Object.freeze({
    module: "crm",
    resource: "leads",
    fields: Object.freeze(["email", "phone", "mobile", "customData", "consentEmail", "consentSms", "consentWhatsapp", "doNotContact", "qualificationReasonText", "qualificationNote", "scoreExplanation", "normalizedEmail", "normalizedMobile", "normalizedBusinessPhone"]),
    readPermission: "crm.leads.view_sensitive",
    writePermission: "crm.leads.view_sensitive",
    ownerBypass: true,
    enforcement: Object.freeze({
      read: "services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-security.js#projectLeadForContext",
      write: "services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-security.js#firstSensitiveLeadInputField",
    }),
    channels: channels({ report: "excluded", export: "projected", jobs: "projected" }),
    note: "Report dataset crm.leads has no contact columns; the CSV export is built from listCrmRecords with the requester's re-resolved context.",
  }),
  Object.freeze({
    module: "crm",
    resource: "contacts",
    fields: Object.freeze(["email", "phone", "mobile", "normalizedEmail", "normalizedMobile"]),
    readPermission: "crm.contacts.view_sensitive",
    writePermission: "crm.contacts.view_sensitive",
    ownerBypass: true,
    enforcement: Object.freeze({
      read: "services/api/src/modules/crm/prospect-and-relationship-master-data/contact-security.js#projectContactForContext",
      write: "services/api/src/modules/crm/prospect-and-relationship-master-data/contact-security.js#firstSensitiveContactInputField",
    }),
    channels: channels(),
  }),
  Object.freeze({
    module: "crm",
    resource: "accounts",
    fields: Object.freeze(["gstin", "pan", "msmeNumber", "normalizedPan"]),
    readPermission: "crm.accounts.view_sensitive",
    writePermission: "crm.accounts.view_sensitive",
    ownerBypass: true,
    enforcement: Object.freeze({
      read: "services/api/src/modules/crm/prospect-and-relationship-master-data/account-security.js#projectAccountForContext",
      write: "services/api/src/modules/crm/prospect-and-relationship-master-data/account-security.js#firstSensitiveAccountInputField",
    }),
    channels: channels(),
  }),
  Object.freeze({
    module: "procurement",
    resource: "suppliers",
    fields: Object.freeze(["bankAccountNumber", "bankAccountName", "bankName", "bankBranch", "bankIfscCode", "bankSwiftCode", "bankRoutingNumber", "bankIban"]),
    readPermission: "procurement.suppliers.sensitive",
    writePermission: "procurement.suppliers.sensitive",
    ownerBypass: true,
    enforcement: Object.freeze({
      read: "services/api/src/modules/procurement/index.js#applySupplierFieldVisibility",
      write: "services/api/src/modules/procurement/index.js#assertSupplierSensitiveFieldsAllowed",
    }),
    channels: channels(),
  }),
  Object.freeze({
    module: "hr-payroll",
    resource: "employees",
    fields: Object.freeze(["personal_email", "personal_phone", "date_of_birth", "gender", "marital_status", "nationality", "address", "bank_details", "tax_identifiers", "statutory_identifiers", "emergency_contacts"]),
    readPermission: "hr_payroll.sensitive.view",
    writePermission: "hr_payroll.sensitive.view",
    ownerBypass: false,
    enforcement: Object.freeze({
      read: "services/api/src/modules/hr-payroll/common.js#EMPLOYEE_SENSITIVE",
      write: "services/api/src/modules/hr-payroll/index.js#EMPLOYEE_SENSITIVE_FIELDS",
    }),
    channels: channels({ events: "not-exposed", automation: "not-exposed" }),
    note: "An employee always sees their own record through self-service.",
  }),
  Object.freeze({
    module: "hr-payroll",
    resource: "compensation",
    fields: Object.freeze(["*"]),
    readPermission: "hr_payroll.sensitive.view",
    writePermission: "hr_payroll.compensation.manage",
    ownerBypass: false,
    enforcement: Object.freeze({
      read: "services/api/src/modules/hr-payroll/compensation.js#SEE",
      write: "services/api/src/modules/hr-payroll/compensation.js#MANAGE",
    }),
    channels: channels({ detail: "gated", list: "gated", events: "not-exposed", automation: "not-exposed" }),
    note: "Salary structures and compensation are whole-record gated; the module event log that records CTC changes (tenant.hr_payroll_events) has no reader.",
  }),
  Object.freeze({
    module: "support",
    resource: "private_notes_and_attachments",
    fields: Object.freeze(["*"]),
    readPermission: "support.sensitive.view",
    writePermission: "support.sensitive.view",
    ownerBypass: false,
    enforcement: Object.freeze({ read: "services/api/src/modules/support/common.js#stripPrivate", write: "services/api/src/modules/support/index.js#support.sensitive.view" }),
    channels: channels({ detail: "gated", list: "gated", attachments: "gated", events: "not-exposed", automation: "not-exposed" }),
    note: "Record-level: a private note/attachment is visible to sensitive viewers and its author only; portal customers never see private items.",
  }),
  Object.freeze({
    module: "sales",
    resource: "quotations_orders_items",
    fields: Object.freeze(["standard_cost", "cost_amount", "cost_total", "margin_amount", "margin_percent"]),
    readPermission: "sales.margin.view",
    writePermission: null,
    ownerBypass: false,
    enforcement: Object.freeze({ read: "services/api/src/modules/sales/index.js#redactMargin", write: "computed server-side from item costs; never client input" }),
    channels: channels({ report: "gated", document: "excluded", events: "not-exposed", automation: "not-exposed" }),
    note: "The margin report requires sales.margin.view; the sales.orders report dataset and quotation/order PDFs use explicit columns without cost or margin.",
  }),
  Object.freeze({
    module: "manufacturing",
    resource: "costing",
    fields: Object.freeze(["cost", "rate", "hourly_rate", "unit_cost", "issued_cost", "laborCost", "overheadCost"]),
    readPermission: "manufacturing.costing.view",
    writePermission: null,
    ownerBypass: false,
    enforcement: Object.freeze({
      read: "services/api/src/modules/manufacturing/execution.js#seeCost;services/api/src/modules/manufacturing/shopfloor.js#seeCost;services/api/src/modules/manufacturing/routing.js#seeCost;services/api/src/modules/manufacturing/costing.js#needCost",
      write: "computed server-side from postings; never client input",
    }),
    channels: channels({ report: "gated", events: "not-exposed", automation: "not-exposed" }),
  }),
  Object.freeze({
    module: "projects",
    resource: "projects",
    fields: Object.freeze(["approved_budget", "contracted_revenue"]),
    readPermission: "projects.profitability.view",
    writePermission: "projects.profitability.view",
    ownerBypass: true,
    enforcement: Object.freeze({ read: "services/api/src/modules/projects/setup.js#maskProject", write: "services/api/src/modules/projects/setup.js#assertFinanceFieldsWritable" }),
    channels: channels({ report: "gated", events: "not-exposed", automation: "not-exposed" }),
    note: "Any project finance permission reveals them (canSeeFinance: budget.manage, billing.manage, profitability.view, approve, reports.view).",
  }),
  Object.freeze({
    module: "accounting",
    resource: "bank_accounts",
    fields: Object.freeze(["masked_account_number"]),
    readPermission: "accounting.view",
    writePermission: "accounting.bank.manage",
    ownerBypass: false,
    enforcement: Object.freeze({ read: "structural", write: "services/api/src/modules/accounting/banking.js#masked_account_number" }),
    channels: channels({ detail: "structural", list: "structural" }),
    note: "Full bank account numbers are never stored: only a masked number is accepted and kept.",
  }),
  Object.freeze({
    module: "point-of-sale",
    resource: "payment_provider_configs",
    fields: Object.freeze(["credential_env_var"]),
    readPermission: "pos.payment.manage",
    writePermission: "pos.payment.manage",
    ownerBypass: false,
    enforcement: Object.freeze({ read: "structural", write: "services/api/src/modules/point-of-sale/store-terminal-and-cashier-control/settings-and-payment-config.js#credentialEnvVar" }),
    channels: channels({ detail: "structural", list: "structural" }),
    note: "Provider credentials are never accepted or stored; only the NAME of the environment variable that holds one.",
  }),
]);

// Modules audited with no field-level rule: their sensitive data is protected
// at record/permission level only (evidence: no existing field projection or
// sensitive permission in the module).
export const FIELD_SECURITY_NOT_APPLICABLE = Object.freeze({
  assets: "Asset register values are visible to every assets.view holder; no sensitive-field permission exists.",
  stock: "Stock quantities and valuation are protected by stock permissions at record level; no field rule exists.",
  quality: "Inspection data carries no personal or financial sensitive fields.",
});

export const FIELD_SECURITY_CHANNELS = CHANNELS;

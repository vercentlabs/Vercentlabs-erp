import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

/**
 * The approved Vercentlabs ERP launch (MVP) capability register — the single
 * source of truth for what the public website may describe as a Vercentlabs
 * ERP capability, and for every product-breadth count it shows.
 *
 * This is the product owner's approved launch-product scope, not an
 * engineering completion audit: an entry here means "approved MVP
 * capability", never "implemented requirement". It replaces the historical
 * 991 (897 module + 94 platform) requirement allocation, which described a
 * larger pre-launch scope and must not be used as public product proof.
 *
 * Owners are the 12 business modules (canonical keys from
 * @vercentlabs/shared-types ERP_MODULE_CATALOG) plus the Shared Platform.
 * `label` is the buyer-facing name used where the register is listed; module
 * pages keep the catalog `name`.
 *
 * Counts and the total are always derived from the entries below — never type
 * a capability count anywhere else.
 */

export const SHARED_PLATFORM_KEY = "shared-platform";

const OWNER_LABELS = Object.freeze({
  crm: "CRM",
  sales: "Sales",
  procurement: "Procurement",
  stock: "Inventory / Stock",
  manufacturing: "Manufacturing",
  projects: "Projects",
  assets: "Assets",
  "point-of-sale": "Point of Sale (POS)",
  quality: "Quality",
  support: "Support / Customer Service",
  "hr-payroll": "HR & Payroll",
  accounting: "Accounting / Finance",
  [SHARED_PLATFORM_KEY]: "Shared Platform",
});

const OWNER_ID_PREFIXES = Object.freeze({
  crm: "crm",
  sales: "sales",
  procurement: "procurement",
  stock: "stock",
  manufacturing: "manufacturing",
  projects: "projects",
  assets: "assets",
  "point-of-sale": "pos",
  quality: "quality",
  support: "support",
  "hr-payroll": "hr",
  accounting: "accounting",
  [SHARED_PLATFORM_KEY]: "platform",
});

/** [slug, name] pairs per owner, in the approved list's order. */
const APPROVED_CAPABILITIES = Object.freeze({
  crm: [
    ["leads", "Leads"],
    ["accounts", "Accounts / Companies"],
    ["contacts", "Contacts"],
    ["lead-assignment", "Lead Assignment"],
    ["lead-qualification", "Lead Qualification"],
    ["lead-stages-statuses", "Lead Stages and Statuses"],
    ["duplicate-detection", "Duplicate Detection"],
    ["opportunities", "Opportunities"],
    ["opportunity-pipeline", "Opportunity Pipeline"],
    ["sales-stages", "Sales Stages"],
    ["tasks", "Tasks"],
    ["follow-ups-reminders", "Follow-ups and Reminders"],
    ["notes-attachments", "Notes and Attachments"],
    ["lead-to-opportunity-conversion", "Lead-to-Opportunity Conversion"],
    ["opportunity-to-quotation-conversion", "Opportunity-to-Quotation Conversion"],
    ["won-lost-reasons", "Won / Lost Reasons"],
  ],
  sales: [
    ["customer-master", "Customer Master"],
    ["customer-addresses-contacts", "Customer Addresses and Contacts"],
    ["products-services", "Products and Services"],
    ["quotations", "Quotations"],
    ["discounts", "Discounts"],
    ["taxes", "Taxes"],
    ["sales-orders", "Sales Orders"],
    ["order-confirmation", "Order Confirmation"],
    ["availability-check", "Availability Check"],
    ["stock-reservation", "Stock Reservation"],
    ["delivery-shipment", "Delivery and Shipment"],
    ["sales-invoices", "Sales Invoices"],
    ["credit-notes-refunds", "Credit Notes and Refunds"],
    ["payment-terms", "Payment Terms"],
    ["order-status-tracking", "Order Status Tracking"],
  ],
  procurement: [
    ["supplier-master", "Supplier Master"],
    ["supplier-contacts-addresses", "Supplier Contacts and Addresses"],
    ["purchase-orders", "Purchase Orders"],
    ["goods-receipt", "Goods Receipt / GRN"],
    ["rejected-receipts", "Rejected Receipts"],
    ["supplier-invoices", "Supplier Invoices"],
    ["two-way-matching", "2-Way Matching"],
    ["three-way-matching", "3-Way Matching — PO → GRN → Supplier Invoice"],
    ["payment-terms", "Payment Terms"],
  ],
  stock: [
    ["item-master", "Item Master"],
    ["skus", "SKUs"],
    ["multiple-uom", "Multiple UOM"],
    ["warehouses", "Warehouses"],
    ["real-time-stock-balance", "Real-Time Stock Balance"],
    ["stock-ledger", "Stock Ledger"],
    ["goods-receipts", "Goods Receipts"],
    ["goods-issues", "Goods Issues"],
    ["internal-transfers", "Internal Transfers"],
    ["stock-adjustments", "Stock Adjustments"],
    ["stock-reservations", "Stock Reservations"],
    ["available-stock", "Available Stock"],
    ["physical-inventory", "Physical Inventory"],
    ["negative-stock-control", "Negative-Stock Control"],
    ["inventory-valuation", "Inventory Valuation"],
    ["quarantine-quality-held-stock", "Quarantine / Quality-Held Stock"],
    ["inventory-movement-history", "Inventory Movement History"],
  ],
  manufacturing: [
    ["bill-of-materials", "Bill of Materials / BOM"],
    ["manufacturing-orders", "Manufacturing Orders"],
    ["material-availability", "Material Availability"],
    ["material-issue", "Material Issue"],
    ["material-consumption", "Material Consumption"],
    ["finished-goods-receipt", "Finished-Goods Receipt"],
    ["scrap", "Scrap"],
    ["production-quality-inspections", "Production Quality Inspections"],
    ["production-hold", "Production Hold"],
    ["production-costing", "Production Costing"],
  ],
  projects: [
    ["projects", "Projects"],
    ["milestones", "Milestones"],
    ["tasks", "Tasks"],
    ["assignees", "Assignees"],
    ["priority", "Priority"],
    ["project-status", "Project Status"],
    ["timesheets", "Timesheets"],
    ["comments-collaboration", "Comments and Collaboration"],
    ["progress-tracking", "Progress Tracking"],
  ],
  assets: [
    ["asset-register", "Asset Register"],
    ["asset-categories", "Asset Categories"],
    ["asset-identification-code", "Asset Identification and Code"],
    ["asset-location", "Asset Location"],
    ["custodian", "Custodian"],
    ["purchase-capitalization", "Purchase and Capitalization"],
    ["asset-transfers", "Asset Transfers"],
    ["asset-assignment", "Asset Assignment"],
    ["asset-movement-history", "Asset Movement History"],
    ["straight-line-depreciation", "Straight-Line Depreciation"],
    ["depreciation-schedule", "Depreciation Schedule"],
    ["asset-maintenance", "Asset Maintenance"],
    ["asset-disposal", "Asset Disposal"],
  ],
  // The approved list groups "Cash / Card / UPI and Digital Payments" on one
  // line; canonically that is three capabilities — Cash Payments, Card
  // Payments, and UPI / Digital Payments (UPI and other digital payments are
  // one capability) — which keeps POS at 19.
  "point-of-sale": [
    ["stores-outlets", "Stores and Outlets"],
    ["terminals", "POS Terminals"],
    ["cashiers", "Cashiers"],
    ["cashier-permissions", "Cashier Permissions"],
    ["product-search", "Product Search"],
    ["cart", "Cart"],
    ["taxes", "Taxes"],
    ["cash-payments", "Cash Payments"],
    ["card-payments", "Card Payments"],
    ["upi-digital-payments", "UPI / Digital Payments"],
    ["receipt-printing", "Receipt Printing"],
    ["returns", "Returns"],
    ["refunds", "Refunds"],
    ["stock-reduction", "Stock Reduction"],
    ["real-time-inventory", "Real-Time Inventory"],
    ["shift-opening", "Shift Opening"],
    ["shift-closing", "Shift Closing"],
    ["day-end-z-report", "Day-End / Z Report"],
    ["payment-reconciliation", "Payment Reconciliation"],
  ],
  quality: [
    ["inspection-specifications", "Inspection Specifications"],
    ["quality-control-points", "Quality Control Points"],
    ["incoming-inspection", "Incoming Inspection"],
    ["in-process-inspection", "In-Process Inspection"],
    ["final-inspection", "Final Inspection"],
    ["pass-fail-checks", "Pass / Fail Checks"],
    ["inspection-results", "Inspection Results"],
    ["non-conformance-report", "Non-Conformance Report / NCR"],
    ["quality-hold", "Quality Hold"],
    ["quality-hold-blocks-stock-movement", "Quality Hold Must Block Stock Movement"],
    ["hold-release", "Hold Release"],
    ["disposition", "Disposition"],
  ],
  support: [
    ["tickets", "Tickets / Cases"],
    ["ticket-number", "Ticket Number"],
    ["customer", "Customer"],
    ["contact", "Contact"],
    ["category", "Category"],
    ["priority", "Priority"],
    ["status", "Status"],
    ["agent-assignment", "Agent Assignment"],
    ["manual-ticket-creation", "Manual Ticket Creation"],
    ["customer-replies", "Customer Replies"],
    ["internal-notes", "Internal / Private Notes"],
    ["attachments", "Attachments"],
    ["ticket-history", "Ticket History"],
    ["reopen-ticket", "Reopen Ticket"],
  ],
  "hr-payroll": [
    ["employee-master", "Employee Master"],
    ["employee-number", "Employee Number"],
    ["departments", "Departments"],
    ["designations", "Designations"],
    ["reporting-manager", "Reporting Manager"],
    ["branch-location", "Branch / Location"],
    ["employment-type", "Employment Type"],
    ["joining", "Joining"],
    ["shifts", "Shifts"],
    ["attendance", "Attendance"],
    ["check-in-check-out", "Check-In / Check-Out"],
    ["leave-types", "Leave Types"],
    ["leave-balances", "Leave Balances"],
    ["holiday-calendars", "Holiday Calendars"],
    ["leave-requests", "Leave Requests"],
    ["leave-approval", "Leave Approval"],
    ["salary-components", "Salary Components"],
    ["salary-structures", "Salary Structures"],
    ["compensation-assignment", "Employee Compensation Assignment"],
    ["payroll-periods", "Payroll Periods"],
    ["payroll-calculation", "Payroll Calculation"],
    ["payroll-approval", "Payroll Approval"],
    ["payslips", "Payslips"],
  ],
  accounting: [
    ["chart-of-accounts", "Chart of Accounts"],
    ["general-ledger", "General Ledger"],
    ["journal-entries", "Journal Entries"],
    ["double-entry-enforcement", "Double-Entry Enforcement"],
    ["fiscal-years", "Fiscal Years"],
    ["accounting-periods", "Accounting Periods"],
    ["customer-invoices", "Customer Invoices / Accounts Receivable Posting"],
    ["customer-receipts", "Customer Receipts"],
    ["supplier-invoices", "Supplier Invoices / Accounts Payable Posting"],
    ["supplier-payments", "Supplier Payments"],
    ["bank-accounts", "Bank Accounts"],
    ["cash-accounts", "Cash Accounts"],
    ["payment-allocation", "Payment Allocation"],
    ["bank-payment-reconciliation", "Bank / Payment Reconciliation"],
    ["gst-tax-posting", "GST Tax Posting"],
    ["trial-balance", "Trial Balance"],
    ["profit-and-loss", "Profit & Loss"],
    ["balance-sheet", "Balance Sheet"],
    ["audit-trail", "Audit Trail"],
  ],
  [SHARED_PLATFORM_KEY]: [
    ["tenant-management", "Tenant Management"],
    ["company-management", "Company Management"],
    ["authentication", "Authentication"],
    ["login-logout", "Login / Logout"],
    ["forgot-reset-password", "Forgot / Reset Password"],
    ["session-management", "Session Management"],
    ["user-management", "User Management"],
    ["user-invitation", "User Invitation"],
    ["activation-deactivation", "Activation / Deactivation"],
    ["roles", "Roles"],
    ["permissions", "Permissions"],
    ["record-level-access", "Record-Level Access"],
    ["company-branch-access", "Company / Branch Access"],
    ["module-enable-disable", "Module Enable / Disable"],
    ["subscription-plan-enforcement", "Subscription / Plan Enforcement"],
    ["company-settings", "Company Settings"],
    ["currency", "Currency"],
    ["timezone", "Timezone"],
    ["date-time-formats", "Date / Time Formats"],
    ["tax-configuration", "Tax Configuration"],
    ["document-numbering", "Document Numbering"],
    ["pdf-print", "PDF / Print Infrastructure"],
    ["comments", "Comments"],
    ["attachments", "Attachments"],
    ["activity-history", "Activity History"],
    ["notifications", "Notifications"],
    ["audit-logs", "Audit Logs"],
    ["import", "Import"],
    ["export", "Export"],
    ["search", "Search"],
    ["filtering", "Filtering"],
    ["sorting", "Sorting"],
    ["pagination", "Pagination"],
    ["validation", "Validation"],
    ["transaction-safety", "Transaction Safety"],
    ["idempotency", "Idempotency"],
    ["concurrency-protection", "Concurrency Protection"],
    ["error-handling", "Error Handling"],
    // One approved capability: the loading, empty, and error states of the interface.
    ["loading-empty-error-states", "Loading / Empty / Error States"],
    ["backups", "Backups"],
    ["restore-process", "Restore Process"],
    ["logging", "Logging"],
    ["monitoring", "Monitoring"],
    ["health-checks", "Health Checks"],
    ["responsive-ui", "Responsive UI"],
    ["permission-aware-navigation", "Permission-Aware Navigation"],
  ],
});

/** Business modules in ERP_MODULE_CATALOG order, then the Shared Platform. */
export const LAUNCH_CAPABILITY_OWNERS = Object.freeze([
  ...ERP_MODULE_CATALOG.map((module) => Object.freeze({ key: module.key, label: OWNER_LABELS[module.key], kind: "module" })),
  Object.freeze({ key: SHARED_PLATFORM_KEY, label: OWNER_LABELS[SHARED_PLATFORM_KEY], kind: "platform" }),
]);

export const LAUNCH_CAPABILITIES = Object.freeze(
  LAUNCH_CAPABILITY_OWNERS.flatMap((owner) =>
    (APPROVED_CAPABILITIES[owner.key] ?? []).map(([slug, name]) =>
      Object.freeze({ id: `${OWNER_ID_PREFIXES[owner.key]}-${slug}`, moduleKey: owner.key, name }),
    ),
  ),
);

/** Capability count per owner key, derived from LAUNCH_CAPABILITIES. */
export const LAUNCH_CAPABILITY_COUNTS = Object.freeze(
  Object.fromEntries(
    LAUNCH_CAPABILITY_OWNERS.map((owner) => [owner.key, LAUNCH_CAPABILITIES.filter((capability) => capability.moduleKey === owner.key).length]),
  ),
);

export const LAUNCH_CAPABILITY_TOTAL = LAUNCH_CAPABILITIES.length;

/** Number of business modules that own launch capabilities (excludes the Shared Platform). */
export const LAUNCH_BUSINESS_MODULE_COUNT = LAUNCH_CAPABILITY_OWNERS.filter((owner) => owner.kind === "module").length;

const CAPABILITY_BY_ID = new Map(LAUNCH_CAPABILITIES.map((capability) => [capability.id, capability]));

export function getLaunchCapability(id) {
  return CAPABILITY_BY_ID.get(id) ?? null;
}

export function getLaunchCapabilitiesForOwner(ownerKey) {
  return LAUNCH_CAPABILITIES.filter((capability) => capability.moduleKey === ownerKey);
}

export function getLaunchCapabilityOwner(ownerKey) {
  return LAUNCH_CAPABILITY_OWNERS.find((owner) => owner.key === ownerKey) ?? null;
}

/** Names for a list of capability IDs; throws on an unknown ID so content can't reference a capability outside the register. */
export function launchCapabilityNames(ids) {
  return ids.map((id) => {
    const capability = CAPABILITY_BY_ID.get(id);
    if (!capability) throw new Error(`Unknown launch capability id "${id}" — add it to launch-capabilities.js or fix the reference.`);
    return capability.name;
  });
}

/** Public proof line, always derived: "222 approved MVP capabilities across 12 business modules and the Shared Platform". */
export const LAUNCH_CAPABILITY_SUMMARY = `${LAUNCH_CAPABILITY_TOTAL} approved MVP capabilities across ${LAUNCH_BUSINESS_MODULE_COUNT} business modules and the Shared Platform`;

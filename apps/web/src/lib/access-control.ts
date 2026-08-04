import { ALL_PERMISSIONS } from "@vercentlabs/permissions";

export const CURRENT_MODULE_KEYS = [
  "platform",
  "crm",
  "sales",
  "accounting",
  "procurement",
] as const;

export const FUTURE_MODULE_KEYS = [
  "stock",
  "manufacturing",
  "hr-payroll",
] as const;

export type AccessModuleKey =
  (typeof CURRENT_MODULE_KEYS)[number] | (typeof FUTURE_MODULE_KEYS)[number];

export type RoleRiskLevel = "standard" | "sensitive" | "privileged";

export type RoleTemplate = {
  name: string;
  slug: string;
  description: string;
  moduleKey: AccessModuleKey;
  riskLevel: RoleRiskLevel;
  assignable: boolean;
  permissions: readonly string[];
};

const base = ["workspace.view", "notifications.view", "profile.manage"];
const businessReader = [...base, "business_data.view"];
const crmReader = [...businessReader, "crm.view", "crm.reports.view"];
const salesReader = [...businessReader, "sales.view", "sales.reports.view"];
const accountingReader = [
  ...businessReader,
  "accounting.view",
  "accounting.reports.view",
];
const procurementReader = [
  ...businessReader,
  "procurement.view",
  "procurement.suppliers.view",
  "procurement.reports.view",
];

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: "Organisation Owner",
    slug: "organization_owner",
    description: "Full organisation ownership and governance.",
    moduleKey: "platform",
    riskLevel: "privileged",
    assignable: false,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "System Administrator",
    slug: "system_administrator",
    description: "Platform configuration, security and access administration.",
    moduleKey: "platform",
    riskLevel: "privileged",
    assignable: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Company Administrator",
    slug: "company_administrator",
    description:
      "Company, branch, department, user and module administration without organisation ownership or billing control.",
    moduleKey: "platform",
    riskLevel: "privileged",
    assignable: true,
    permissions: ALL_PERMISSIONS.filter(
      (key) =>
        key !== "organization.manage" &&
        key !== "crm.ai.manage" &&
        !["billing.manage", "billing.checkout", "billing.audit"].includes(key),
    ),
  },
  {
    name: "Employee",
    slug: "employee",
    description:
      "Basic employee access. Business permissions must be added through another role.",
    moduleKey: "platform",
    riskLevel: "standard",
    assignable: true,
    permissions: businessReader,
  },
  {
    name: "Auditor",
    slug: "auditor",
    description:
      "Read-only governance, audit and released-module reporting access.",
    moduleKey: "platform",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...base,
      "users.view",
      "roles.view",
      "audit.view",
      "business_data.view",
      "crm.view",
      "crm.export",
      "crm.reports.view",
      "billing.view",
      "billing.audit",
      "sales.view",
      "sales.margin.view",
      "sales.reports.view",
      "accounting.view",
      "accounting.reports.view",
      "accounting.audit.view",
      "procurement.view",
      "procurement.suppliers.view",
      "procurement.reports.view",
      "procurement.audit.view",
    ]),
  },
  {
    name: "Read-only User",
    slug: "read_only",
    description:
      "Read-only access to the released business modules and reports within assigned companies and branches.",
    moduleKey: "platform",
    riskLevel: "standard",
    assignable: true,
    permissions: unique([
      ...base,
      "business_data.view",
      "crm.view",
      "crm.reports.view",
      "sales.view",
      "sales.reports.view",
      "accounting.view",
      "accounting.reports.view",
      "procurement.view",
      "procurement.suppliers.view",
      "procurement.reports.view",
    ]),
  },
  {
    name: "CRM Administrator",
    slug: "crm_administrator",
    description:
      "CRM configuration, integrations, data quality, automation and administration.",
    moduleKey: "crm",
    riskLevel: "privileged",
    assignable: true,
    permissions: unique([
      ...crmReader,
      "parties.manage",
      "crm.leads.manage",
      "crm.opportunities.manage",
      "crm.activities.manage",
      "crm.campaigns.manage",
      "crm.communications.manage",
      "crm.automation.manage",
      "crm.capture.manage",
      "crm.import",
      "crm.export",
      "crm.settings.manage",
      "crm.revenue.manage",
      "crm.accounts.manage",
      "crm.playbooks.manage",
      "crm.privacy.manage",
      "crm.data-quality.manage",
      "crm.integrations.manage",
      "crm.ai.manage",
      "crm.analytics.manage",
      "crm.customization.manage",
      "crm.partners.manage",
      "crm.field-sales.manage",
    ]),
  },
  {
    name: "Sales Head",
    slug: "sales_head",
    description:
      "Organisation-wide sales leadership, forecasts, approvals, targets and commercial governance.",
    moduleKey: "sales",
    riskLevel: "privileged",
    assignable: true,
    permissions: unique([
      ...crmReader,
      ...salesReader,
      "approvals.manage",
      "parties.manage",
      "crm.leads.manage",
      "crm.opportunities.manage",
      "crm.activities.manage",
      "crm.communications.manage",
      "crm.revenue.manage",
      "crm.accounts.manage",
      "crm.playbooks.manage",
      "crm.analytics.manage",
      "sales.quotation.send",
      "sales.quotation.approve",
      "sales.quotation.accept_on_behalf",
      "sales.order.confirm",
      "sales.order.approve",
      "sales.order.amend",
      "sales.order.hold",
      "sales.order.cancel",
      "sales.fulfillment.request",
      "sales.invoice.request",
      "sales.price.override",
      "sales.margin.view",
      "sales.credit.override",
      "sales.settings.manage",
    ]),
  },
  {
    name: "Sales Manager",
    slug: "sales_manager",
    description:
      "Team pipeline, opportunities, forecasts, quotations and sales approvals.",
    moduleKey: "sales",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...crmReader,
      ...salesReader,
      "approvals.manage",
      "parties.manage",
      "crm.leads.manage",
      "crm.opportunities.manage",
      "crm.activities.manage",
      "crm.communications.manage",
      "crm.revenue.manage",
      "crm.accounts.manage",
      "crm.playbooks.manage",
      "crm.analytics.manage",
      "sales.quotation.send",
      "sales.quotation.approve",
      "sales.order.confirm",
      "sales.order.approve",
      "sales.order.amend",
      "sales.order.hold",
      "sales.order.cancel",
      "sales.price.override",
      "sales.margin.view",
      "sales.credit.override",
    ]),
  },
  {
    name: "Sales Representative",
    slug: "sales_representative",
    description:
      "Manage assigned leads, accounts, opportunities, activities, quotations and sales orders.",
    moduleKey: "sales",
    riskLevel: "standard",
    assignable: true,
    permissions: unique([
      ...crmReader,
      ...salesReader,
      "parties.manage",
      "crm.leads.manage",
      "crm.opportunities.manage",
      "crm.activities.manage",
      "crm.communications.manage",
      "crm.accounts.manage",
      "crm.playbooks.manage",
      "crm.field-sales.manage",
      "sales.quotation.create",
      "sales.quotation.send",
      "sales.order.create",
      "sales.fulfillment.request",
      "sales.invoice.request",
    ]),
  },
  {
    name: "Sales Operations",
    slug: "sales_operations",
    description:
      "Sales data quality, assignment, imports, configuration and reporting without commercial approval authority.",
    moduleKey: "sales",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...crmReader,
      ...salesReader,
      "parties.manage",
      "crm.leads.manage",
      "crm.opportunities.manage",
      "crm.activities.manage",
      "crm.import",
      "crm.export",
      "crm.settings.manage",
      "crm.data-quality.manage",
      "crm.analytics.manage",
      "crm.customization.manage",
      "sales.settings.manage",
      "sales.margin.view",
    ]),
  },
  {
    name: "Marketing Manager",
    slug: "marketing_manager",
    description:
      "Campaigns, segments, journeys, forms, events, attribution and marketing integrations.",
    moduleKey: "crm",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...crmReader,
      "parties.manage",
      "crm.leads.manage",
      "crm.activities.manage",
      "crm.campaigns.manage",
      "crm.communications.manage",
      "crm.automation.manage",
      "crm.capture.manage",
      "crm.import",
      "crm.export",
      "crm.integrations.manage",
      "crm.analytics.manage",
    ]),
  },
  {
    name: "Customer Success Manager",
    slug: "customer_success_manager",
    description:
      "Customer health, success plans, renewals, feedback, playbooks and account engagement.",
    moduleKey: "crm",
    riskLevel: "standard",
    assignable: true,
    permissions: unique([
      ...crmReader,
      "parties.manage",
      "crm.accounts.manage",
      "crm.activities.manage",
      "crm.communications.manage",
      "crm.playbooks.manage",
      "crm.revenue.manage",
      "crm.analytics.manage",
    ]),
  },
  {
    name: "Partner Manager",
    slug: "partner_manager",
    description:
      "Partner onboarding, deal registration, MDF, partner performance and field engagement.",
    moduleKey: "crm",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...crmReader,
      "parties.manage",
      "crm.opportunities.manage",
      "crm.activities.manage",
      "crm.partners.manage",
      "crm.field-sales.manage",
      "crm.analytics.manage",
    ]),
  },
  {
    name: "Finance Manager",
    slug: "finance_manager",
    description:
      "Finance governance, period close, budgets, taxes, policies and accounting approvals.",
    moduleKey: "accounting",
    riskLevel: "privileged",
    assignable: true,
    permissions: unique([
      ...accountingReader,
      "approvals.manage",
      "parties.manage",
      "finance_setup.manage",
      "billing.view",
      "billing.manage",
      "billing.checkout",
      "billing.audit",
      "sales.view",
      "sales.quotation.approve",
      "sales.order.approve",
      "sales.invoice.request",
      "sales.margin.view",
      "sales.credit.override",
      "accounting.journal.approve",
      "accounting.journal.post",
      "accounting.journal.reverse",
      "accounting.receivables.approve",
      "accounting.payables.approve",
      "accounting.payments.approve",
      "accounting.period.manage",
      "accounting.close.manage",
      "accounting.close.waive",
      "accounting.budget.manage",
      "accounting.tax.manage",
      "accounting.fx.manage",
      "accounting.intercompany.manage",
      "accounting.assets.manage",
      "accounting.recurring.manage",
      "accounting.consolidation.manage",
      "accounting.settings.manage",
      "accounting.audit.view",
    ]),
  },
  {
    name: "Accountant",
    slug: "accountant",
    description:
      "Journal preparation, receivables, payables and routine accounting operations without approval authority.",
    moduleKey: "accounting",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...accountingReader,
      "parties.manage",
      "finance_setup.manage",
      "accounting.journal.create",
      "accounting.journal.submit",
      "accounting.receivables.manage",
      "accounting.receipts.manage",
      "accounting.collections.manage",
      "accounting.payables.manage",
      "accounting.tax.manage",
      "accounting.fx.manage",
      "accounting.assets.manage",
      "accounting.recurring.manage",
    ]),
  },
  {
    name: "Accounts Receivable Executive",
    slug: "accounts_receivable_executive",
    description:
      "Customer invoices, receipts, allocations, disputes and collections.",
    moduleKey: "accounting",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...accountingReader,
      "parties.manage",
      "accounting.receivables.manage",
      "accounting.receipts.manage",
      "accounting.collections.manage",
    ]),
  },
  {
    name: "Accounts Payable Executive",
    slug: "accounts_payable_executive",
    description:
      "Supplier bills, matching and payment preparation without payment approval.",
    moduleKey: "accounting",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...accountingReader,
      "parties.manage",
      "accounting.payables.manage",
    ]),
  },
  {
    name: "Treasury Executive",
    slug: "treasury_executive",
    description:
      "Payment execution, bank accounts, statements, reconciliation and cash operations without payment approval.",
    moduleKey: "accounting",
    riskLevel: "privileged",
    assignable: true,
    permissions: unique([
      ...accountingReader,
      "accounting.payments.manage",
      "accounting.bank.manage",
      "accounting.bank.reconcile",
      "accounting.fx.manage",
    ]),
  },
  {
    name: "Tax and Compliance Accountant",
    slug: "tax_compliance_accountant",
    description:
      "Tax setup, returns, compliance evidence, FX reporting and audit support.",
    moduleKey: "accounting",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...accountingReader,
      "finance_setup.manage",
      "accounting.tax.manage",
      "accounting.fx.manage",
      "accounting.audit.view",
    ]),
  },
  {
    name: "Procurement Manager",
    slug: "purchase_manager",
    description:
      "Procurement governance, supplier lifecycle, sourcing, contracts and purchasing approvals.",
    moduleKey: "procurement",
    riskLevel: "privileged",
    assignable: true,
    permissions: unique([
      ...procurementReader,
      "approvals.manage",
      "parties.manage",
      "items.manage",
      "finance_setup.manage",
      "procurement.settings.manage",
      "procurement.suppliers.manage",
      "procurement.suppliers.qualify",
      "procurement.suppliers.sensitive",
      "procurement.catalog.manage",
      "procurement.requisition.manage",
      "procurement.requisition.approve",
      "procurement.sourcing.manage",
      "procurement.sourcing.evaluate",
      "procurement.sourcing.award",
      "procurement.contracts.manage",
      "procurement.contracts.approve",
      "procurement.po.manage",
      "procurement.po.approve",
      "procurement.po.amend",
      "procurement.po.cancel",
      "procurement.receipts.approve",
      "procurement.matching.override",
      "procurement.supplier_portal.manage",
      "procurement.audit.view",
    ]),
  },
  {
    name: "Buyer / Purchase Officer",
    slug: "buyer",
    description:
      "Supplier enquiries, sourcing, contracts and purchase-order preparation without approval authority.",
    moduleKey: "procurement",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...procurementReader,
      "parties.manage",
      "items.manage",
      "procurement.suppliers.manage",
      "procurement.suppliers.qualify",
      "procurement.catalog.manage",
      "procurement.requisition.manage",
      "procurement.sourcing.manage",
      "procurement.sourcing.evaluate",
      "procurement.contracts.manage",
      "procurement.po.create",
      "procurement.po.manage",
      "procurement.po.dispatch",
      "procurement.po.amend",
      "procurement.po.cancel",
      "procurement.supplier_portal.manage",
    ]),
  },
  {
    name: "Purchase Requester",
    slug: "purchase_requester",
    description:
      "Create and track purchase requisitions within assigned organisational scope.",
    moduleKey: "procurement",
    riskLevel: "standard",
    assignable: true,
    permissions: unique([
      ...procurementReader,
      "items.manage",
      "procurement.requisition.create",
    ]),
  },
  {
    name: "Purchase Approver",
    slug: "purchase_approver",
    description:
      "Approve requisitions, contracts and purchase orders without creating or dispatching them.",
    moduleKey: "procurement",
    riskLevel: "privileged",
    assignable: true,
    permissions: unique([
      ...procurementReader,
      "approvals.manage",
      "procurement.requisition.approve",
      "procurement.contracts.approve",
      "procurement.po.approve",
      "procurement.receipts.approve",
    ]),
  },
  {
    name: "Goods Receipt User",
    slug: "goods_receipt_user",
    description:
      "Record receipts, inspections, discrepancies and supplier returns.",
    moduleKey: "procurement",
    riskLevel: "standard",
    assignable: true,
    permissions: unique([
      ...procurementReader,
      "procurement.receipts.manage",
      "procurement.inspection.manage",
      "procurement.returns.manage",
    ]),
  },
  {
    name: "Supplier Manager",
    slug: "supplier_manager",
    description:
      "Supplier onboarding, qualification, catalogues, sensitive details and performance records.",
    moduleKey: "procurement",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...procurementReader,
      "parties.manage",
      "procurement.suppliers.manage",
      "procurement.suppliers.qualify",
      "procurement.suppliers.sensitive",
      "procurement.catalog.manage",
      "procurement.supplier_portal.manage",
    ]),
  },
  {
    name: "Inventory Manager",
    slug: "inventory_manager",
    description:
      "Future Stock module role. Unavailable until the module is released.",
    moduleKey: "stock",
    riskLevel: "sensitive",
    assignable: false,
    permissions: unique([
      ...businessReader,
      "items.manage",
      "inventory_setup.manage",
    ]),
  },
  {
    name: "Manufacturing Manager",
    slug: "manufacturing_manager",
    description:
      "Future Manufacturing module role. Unavailable until the module is released.",
    moduleKey: "manufacturing",
    riskLevel: "sensitive",
    assignable: false,
    permissions: unique([
      ...businessReader,
      "items.manage",
      "inventory_setup.manage",
    ]),
  },
  {
    name: "HR Manager",
    slug: "hr_manager",
    description:
      "Future HR & Payroll role. Unavailable until the module is released.",
    moduleKey: "hr-payroll",
    riskLevel: "sensitive",
    assignable: false,
    permissions: businessReader,
  },
] as const;

export const ROLE_TEMPLATE_BY_SLUG = new Map(
  ROLE_TEMPLATES.map((template) => [template.slug, template]),
);

export function permissionsForRole(slug: string) {
  return [...(ROLE_TEMPLATE_BY_SLUG.get(slug)?.permissions || businessReader)];
}

export type SodConflict = {
  key: string;
  first: string;
  second: string;
  severity: "warning" | "blocking";
  description: string;
};

export const SOD_CONFLICTS: readonly SodConflict[] = [
  {
    key: "journal_prepare_approve",
    first: "accounting.journal.create",
    second: "accounting.journal.approve",
    severity: "blocking",
    description:
      "The same access profile must not prepare and approve journals.",
  },
  {
    key: "payment_prepare_approve",
    first: "accounting.payments.manage",
    second: "accounting.payments.approve",
    severity: "blocking",
    description: "Payment execution and payment approval must be separated.",
  },
  {
    key: "sales_order_create_approve",
    first: "sales.order.create",
    second: "sales.order.approve",
    severity: "blocking",
    description: "Sales-order creation and approval must be separated.",
  },
  {
    key: "purchase_order_create_approve",
    first: "procurement.po.create",
    second: "procurement.po.approve",
    severity: "blocking",
    description: "Purchase-order creation and approval must be separated.",
  },
  {
    key: "quotation_create_approve",
    first: "sales.quotation.create",
    second: "sales.quotation.approve",
    severity: "warning",
    description:
      "Quotation creation and approval should normally be separated.",
  },
  {
    key: "supplier_manage_sensitive",
    first: "procurement.suppliers.manage",
    second: "procurement.suppliers.sensitive",
    severity: "warning",
    description:
      "Supplier maintenance and sensitive supplier access should be reviewed.",
  },
  {
    key: "sourcing_evaluate_award",
    first: "procurement.sourcing.evaluate",
    second: "procurement.sourcing.award",
    severity: "warning",
    description:
      "Bid evaluation and award authority should normally be separated.",
  },
];

export function analyzePermissionConflicts(permissionKeys: readonly string[]) {
  const set = new Set(permissionKeys);
  return SOD_CONFLICTS.filter(
    (conflict) => set.has(conflict.first) && set.has(conflict.second),
  );
}

export function permissionsOutsideGrantCeiling(
  actorRoleSlugs: readonly string[],
  actorPermissions: readonly string[],
  requestedPermissions: readonly string[],
) {
  if (actorRoleSlugs.includes("organization_owner")) return [];
  const available = new Set(actorPermissions);
  return unique(requestedPermissions).filter(
    (permission) => !available.has(permission),
  );
}

export function roleIsAvailable(
  moduleKey: string | null | undefined,
  assignable: boolean,
  enabledModules: readonly string[],
) {
  if (!assignable) return false;
  if (!moduleKey || moduleKey === "platform") return true;
  return enabledModules.includes(moduleKey);
}

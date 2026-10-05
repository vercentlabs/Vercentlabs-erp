import { ALL_PERMISSIONS } from "./catalog.js";

// Every business-module key here must match packages/shared-types/src/
// modules.js's ERP_MODULE_CATALOG exactly (plus "platform" for
// cross-module/administrative roles that aren't scoped to one business
// module). All 12 catalogue modules are "released" today, so this list is
// simply CURRENT_MODULE_KEYS = ["platform", ...ERP_MODULE_CATALOG keys].
export const CURRENT_MODULE_KEYS = Object.freeze([
  "platform",
  "crm",
  "sales",
  "accounting",
  "procurement",
  "stock",
  "manufacturing",
  "projects",
  "assets",
  "point-of-sale",
  "quality",
  "support",
  "hr-payroll",
]);

const base = ["workspace.view", "notifications.view", "profile.manage"];
const businessReader = [...base, "business_data.view"];
const crmReader = [...businessReader, "crm.view", "crm.tasks.view", "crm.follow_ups.view", "crm.notes.view", "crm.attachments.view", "crm.attachments.download", "crm.leads.view", "crm.opportunities.view", "crm.accounts.view", "crm.contacts.view", "crm.reports.view"];
// Working a lead day to day: everything a salesperson does to their own leads.
const leadWorker = ["crm.leads.create", "crm.leads.edit", "crm.leads.change_stage", "crm.leads.assign", "crm.leads.assign_self", "crm.leads.qualify", "crm.leads.disqualify", "crm.leads.reopen", "crm.leads.convert", "crm.leads.convert_use_existing", "crm.leads.convert_create_account", "crm.leads.convert_create_contact"];
// Running the lead desk: moving leads between people, archiving, import and export.
// Managers may also qualify a lead whose required criteria are still missing.
// Managers also resolve duplicates: merge leads, review the duplicate queue and
// save a record that matches an existing one, with a reason.
const leadManager = [...leadWorker, "crm.leads.merge", "crm.duplicates.override", "crm.duplicates.review", "crm.leads.reassign", "crm.leads.bulk_assign", "crm.leads.override_qualification", "crm.leads.convert_change_owner", "crm.leads.convert_override_duplicate", "crm.leads.delete", "crm.leads.import", "crm.leads.export"];
// Deciding how leads are routed: the assignment rules and the fallback, giving
// leads to anyone in the organization, and transferring a user's leads.
const leadRouting = ["crm.leads.assign_across_teams", "crm.leads.manage_assignment_rules", "crm.leads.manage_stages"];
// Working a deal day to day: creating it, moving it through the stages,
// quoting it and closing it as won or lost.
const pipelineAdmin = ["crm.pipeline.manage_stages"];
const contentWorker = ["crm.notes.view", "crm.notes.create", "crm.notes.edit_own", "crm.notes.delete_own", "crm.notes.pin", "crm.attachments.view", "crm.attachments.upload", "crm.attachments.download"];
const contentManager = [...contentWorker, "crm.notes.edit_all", "crm.notes.delete_all", "crm.attachments.delete"];
const followUpWorker = ["crm.follow_ups.view", "crm.follow_ups.create", "crm.follow_ups.edit", "crm.follow_ups.complete", "crm.follow_ups.reschedule", "crm.follow_ups.cancel"];
const followUpManager = [...followUpWorker, "crm.follow_ups.reassign", "crm.follow_ups.delete", "crm.follow_ups.view_team"];
const taskWorker = ["crm.tasks.view", "crm.tasks.create", "crm.tasks.edit", "crm.tasks.complete", "crm.tasks.reopen", "crm.tasks.cancel", "crm.tasks.assign"];
const taskManager = [...taskWorker, "crm.tasks.reassign", "crm.tasks.delete", "crm.tasks.view_team"];
const opportunityWorker = [
  ...taskWorker,
  ...followUpWorker,
  ...contentWorker,
  "crm.opportunities.view", "crm.opportunities.create", "crm.opportunities.edit", "crm.opportunities.assign", "crm.opportunities.change_stage",
  "crm.opportunities.create_quotation", "crm.opportunities.mark_won", "crm.opportunities.mark_lost", "crm.opportunities.change_probability",
];
// Running the pipeline: moving deals between people, reopening closed deals,
// archiving or deleting mistakes, and export.
const opportunityManager = [...opportunityWorker, "crm.opportunities.reassign", "crm.opportunities.reopen", "crm.opportunities.edit_close_reason", "crm.opportunities.delete", "crm.opportunities.export", "crm.opportunities.bulk_update", ...taskManager, ...followUpManager, ...contentManager];
// Working accounts day to day: adding companies, keeping them current and
// giving an unowned account an owner.
const accountWorker = ["crm.accounts.create", "crm.accounts.edit", "crm.accounts.assign"];
// Running the account book: moving ownership, merging duplicates, archiving,
// deleting mistakes, import/export and turning prospects into customers.
const accountManager = [
  ...accountWorker, "crm.accounts.reassign", "crm.accounts.archive", "crm.accounts.delete", "crm.accounts.merge",
  "crm.accounts.import", "crm.accounts.export", "crm.accounts.create_customer",
];
// Working contacts day to day: adding people, keeping them current and giving
// an unowned contact an owner.
const contactWorker = ["crm.contacts.create", "crm.contacts.edit", "crm.contacts.assign"];
// Running the contact book: moving ownership, merging duplicates, archiving,
// deleting mistakes, import and export.
const contactManager = [
  ...contactWorker, "crm.contacts.reassign", "crm.contacts.archive", "crm.contacts.delete", "crm.contacts.merge",
  "crm.contacts.import", "crm.contacts.export",
];
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

function unique(values) {
  return [...new Set(values)];
}

// User Administrator is a delegated ADMINISTRATION role, not a business superuser: an
// explicit least-privilege allow-list (never ALL_PERMISSIONS minus a
// deny-list, which silently inherits every future business permission). It
// administers users and may assign only roles whose permissions fit its own
// authority (grant ceiling); it never administers owners or system
// administrators. Business authority is composed by assigning the matching
// module role as well (e.g. Sales Head, CRM Administrator). It deliberately
// lacks organization.manage, roles.manage (organisation-global role
// definitions), modules.manage (organisation-global module enablement), SoD
// override, audit and billing.
export const USER_ADMINISTRATOR_PERMISSIONS = Object.freeze([
  "workspace.view",
  "notifications.view",
  "profile.manage",
  "department.manage",
  "cost_center.manage",
  "team.manage",
  "users.view",
  "users.manage",
  "roles.view",
  "roles.assign",
]);

const ROLE_DEFINITIONS = [
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
    description:
      "Platform configuration, security and access administration.",
    moduleKey: "platform",
    riskLevel: "privileged",
    assignable: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "User Administrator",
    slug: "user_administrator",
    description:
      "Delegated user and role-assignment administration. No business-module, module-enablement, role-definition or billing authority.",
    moduleKey: "platform",
    riskLevel: "privileged",
    assignable: true,
    permissions: USER_ADMINISTRATOR_PERMISSIONS,
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
      // Company-wide CRM READ visibility for auditing (no manage, import,
      // settings or sensitive-field permission); export = this read scope.
      "crm.records.view_all",
      "users.view",
      "roles.view",
      "audit.view",
      "compliance.view",
      "automation.view",
      "integrations.view",
      "data_management.view",
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
      // "Read-only access to the released business modules": company-wide CRM
      // read visibility, no mutation, import, export or settings.
      "crm.records.view_all",
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
      "crm.leads.view_all",
      "crm.customers.view_all",
      "crm.contacts.view_sensitive",
      "crm.accounts.view_sensitive",
      "crm.records.view_all",
      "parties.manage",
      ...leadManager,
      ...leadRouting,
      ...pipelineAdmin,
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
      "crm.opportunities.manage",
      ...opportunityManager,
      "crm.opportunities.view_all",
      "crm.tasks.view_all",
      "crm.follow_ups.view_all",
      "crm.activities.manage",
      "crm.campaigns.manage",
      "crm.communications.manage",
      "crm.automation.manage",
      "crm.capture.manage",
      "crm.import",
      "crm.export",
      "crm.settings.manage",
      "crm.opportunities.manage_close_reasons",
      "crm.revenue.manage",
      ...accountManager,
      ...contactManager,
      "crm.accounts.view_all",
      "crm.contacts.view_all",
      "crm.privacy.manage",
      "crm.data-quality.manage",
      "crm.integrations.manage",
      "crm.ai.manage",
      "crm.analytics.manage",
      "crm.partners.manage",
      "crm.field-sales.manage",
      "automation.view",
      "crm.teams.manage",
      "crm.forecast.submit",
      "crm.forecast.review",
      "crm.forecast.manage",
      "crm.reports.schedule",
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
      "crm.contacts.view_sensitive",
      "crm.accounts.view_sensitive",
      "crm.records.view_all",
      "approvals.manage",
      "parties.manage",
      ...leadManager,
      ...leadRouting,
      ...pipelineAdmin,
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
      "crm.opportunities.manage",
      ...opportunityManager,
      "crm.opportunities.view_all",
      "crm.tasks.view_all",
      "crm.follow_ups.view_all",
      "crm.activities.manage",
      "crm.communications.manage",
      "crm.revenue.manage",
      ...accountManager,
      ...contactManager,
      "crm.accounts.view_all",
      "crm.contacts.view_all",
      "crm.analytics.manage",
      "sales.quotation.send",
      "sales.quotation.approve",
      "sales.quotation.accept_on_behalf",
      "sales.quotation.reject",
      "sales.quotation.cancel",
      "sales.discount.apply",
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
      "crm.teams.manage",
      "crm.forecast.submit",
      "crm.forecast.review",
      "crm.forecast.manage",
      "crm.reports.schedule",
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
      "crm.contacts.view_sensitive",
      "crm.accounts.view_sensitive",
      "approvals.manage",
      "parties.manage",
      ...leadManager,
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
      "crm.opportunities.manage",
      ...opportunityManager,
      "crm.activities.manage",
      "crm.communications.manage",
      "crm.revenue.manage",
      ...accountManager,
      ...contactManager,
      "crm.analytics.manage",
      "sales.quotation.send",
      "sales.quotation.approve",
      "sales.quotation.accept_on_behalf",
      "sales.quotation.reject",
      "sales.quotation.cancel",
      "sales.discount.apply",
      "sales.order.confirm",
      "sales.order.approve",
      "sales.order.amend",
      "sales.order.hold",
      "sales.order.cancel",
      "sales.price.override",
      "sales.margin.view",
      "sales.credit.override",
      "crm.forecast.submit",
      "crm.forecast.review",
      "crm.reports.schedule",
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
      "crm.contacts.view_sensitive",
      "crm.accounts.view_sensitive",
      "parties.manage",
      ...leadWorker,
      "crm.leads.view_sensitive",
      "crm.opportunities.manage",
      ...opportunityWorker,
      "crm.activities.manage",
      "crm.communications.manage",
      ...accountWorker,
      ...contactWorker,
      "crm.field-sales.manage",
      "sales.quotation.create",
      "sales.quotation.send",
      "sales.quotation.revise",
      "sales.quotation.reject",
      "sales.quotation.accept_on_behalf",
      "sales.quotation.cancel",
      "sales.discount.apply",
      "sales.order.create",
      "sales.fulfillment.request",
      "sales.invoice.request",
      "crm.forecast.submit",
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
      "crm.contacts.view_sensitive",
      "crm.accounts.view_sensitive",
      "crm.records.view_all",
      "parties.manage",
      ...leadManager,
      ...leadRouting,
      ...pipelineAdmin,
      ...accountManager,
      ...contactManager,
      "crm.accounts.view_all",
      "crm.contacts.view_all",
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
      "crm.opportunities.manage",
      ...opportunityManager,
      "crm.opportunities.view_all",
      "crm.tasks.view_all",
      "crm.follow_ups.view_all",
      "crm.activities.manage",
      "crm.import",
      "crm.export",
      "crm.settings.manage",
      "crm.opportunities.manage_close_reasons",
      "crm.data-quality.manage",
      "crm.analytics.manage",
      "sales.settings.manage",
      "sales.margin.view",
      "crm.teams.manage",
      "crm.forecast.manage",
      "crm.reports.schedule",
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
      // Every Lead (campaigns, capture, import/export, attribution) — not every
      // Opportunity, Account or sales Activity (crm.records.view_all removed).
      "crm.leads.view_all",
      "crm.contacts.view_sensitive",
      "parties.manage",
      ...leadManager,
      ...contactManager,
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
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
      // Every customer Account, its Contacts and customer Activities — not
      // Leads, prospects or the sales pipeline (crm.records.view_all removed).
      "crm.customers.view_all",
      "crm.contacts.view_sensitive",
      "parties.manage",
      ...accountWorker,
      ...contactWorker,
      "crm.accounts.view_sensitive",
      "crm.activities.manage",
      "crm.communications.manage",
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
      ...opportunityWorker,
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
      "accounting.assets.manage",
      "accounting.recurring.manage",
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
      "Warehouse operations, stock movements, transfers, counts, valuation and replenishment.",
    moduleKey: "stock",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "approvals.manage",
      "items.manage",
      "inventory_setup.manage",
      "stock.view",
      "stock.manage",
      "stock.receive",
      "stock.issue",
      "stock.transfer",
      "stock.adjust",
      "stock.reserve",
      "stock.count",
      "stock.valuation.view",
      "stock.reports.view",
      "stock.settings.manage",
      "stock.audit.view",
    ]),
  },
  {
    name: "Manufacturing Manager",
    slug: "manufacturing_manager",
    description:
      "BOMs, routings, work centers, material planning, work orders, production execution and costing.",
    moduleKey: "manufacturing",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "approvals.manage",
      "items.manage",
      "inventory_setup.manage",
      "stock.view",
      "stock.issue",
      "stock.receive",
      "stock.reserve",
      "stock.valuation.view",
      "manufacturing.view",
      "manufacturing.manage",
      "manufacturing.bom.view",
      "manufacturing.bom.manage",
      "manufacturing.routing.manage",
      "manufacturing.planning.run",
      "manufacturing.work_order.manage",
      "manufacturing.work_order.release",
      "manufacturing.production.post",
      "manufacturing.scrap.post",
      "manufacturing.costing.view",
      "manufacturing.reports.view",
      "manufacturing.settings.manage",
      "manufacturing.audit.view",
    ]),
  },
  {
    name: "Project Manager",
    slug: "project_manager",
    description:
      "Projects, milestones, tasks, resourcing, time, expenses, budgets, billing and profitability.",
    moduleKey: "projects",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "projects.view",
      "projects.manage",
      "projects.create",
      // A second project manager approves (the domain forbids approving your own; platform migration 053).
      "projects.approve",
      "projects.tasks.manage",
      "projects.milestones.manage",
      "projects.resources.manage",
      "projects.time.enter",
      "projects.time.approve",
      "projects.expense.enter",
      "projects.expense.approve",
      "projects.budget.manage",
      "projects.procurement.link",
      "projects.billing.manage",
      "projects.profitability.view",
      "projects.reports.view",
      "projects.settings.manage",
      "projects.audit.view",
    ]),
  },
  {
    name: "Asset Manager",
    slug: "asset_manager",
    description:
      "Asset register, capitalization, custody, maintenance, depreciation, audits, transfers and disposal.",
    moduleKey: "assets",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "assets.view",
      "assets.manage",
      "assets.create",
      "assets.capitalize",
      "assets.assign",
      "assets.transfer",
      "assets.maintain",
      "assets.inspect",
      "assets.depreciate",
      "assets.dispose",
      "assets.accounting.handoff",
      "assets.reports.view",
      "assets.settings.manage",
      "assets.audit.view",
    ]),
  },
  {
    name: "Point of Sale Manager",
    slug: "pos_manager",
    description:
      "Stores, terminals, checkout, payments, returns, cashier shifts and reconciliation.",
    moduleKey: "point-of-sale",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "stock.view",
      "stock.issue",
      "stock.receive",
      "pos.view",
      "pos.operate",
      "pos.shift.open",
      "pos.shift.close",
      // pos.discount.apply deliberately excluded (POS Session 3, F279):
      // pos_manager now holds pos.discount.approve instead, and a single
      // role holding both apply+approve is exactly the same
      // blocking-SoD-conflict shape as pos.return.create+approve below --
      // a manager approves another person's above-threshold discount
      // request; day-to-day discount application belongs to
      // pos_supervisor. A person who genuinely needs both is assigned
      // pos_supervisor alongside pos_manager.
      "pos.discount.approve",
      // pos.return.create deliberately excluded: pos_manager also holds
      // pos.return.approve, and a single role holding both is exactly the
      // blocking pos_return_create_approve SoD conflict below. A manager
      // approves returns; day-to-day return creation belongs to
      // pos_cashier/pos_supervisor. A person who genuinely needs both is
      // assigned pos_cashier or pos_supervisor alongside pos_manager.
      "pos.return.approve",
      "pos.cash.adjust",
      "pos.price.override",
      "pos.terminal.manage",
      "pos.store.manage",
      "pos.payment.manage",
      "pos.payment.refund",
      "pos.payment.override",
      "pos.reports.view",
      "pos.settings.manage",
      "pos.audit.view",
      // F303: pos_manager is the finalize/lock authority for the Z report —
      // deliberately NOT pos.report.generate (see pos_supervisor below and
      // the pos_day_end_generate_finalize SoD conflict), so the person who
      // finalizes a day-end report is never the same role tier that
      // generated/reviewed its draft.
      "pos.report.finalize",
      "pos.report.view",
      // F297/F298: a manager reviews/resolves offline-sync conflicts other
      // cashiers' devices produced (never creates sales, so no
      // pos.offline.sync grant here).
      "pos.offline.resolve",
      // F306: program configuration sits at the same tier as
      // pos.settings.manage; redemption is already implied by
      // pos.sale.create's checkout authority but listed explicitly for
      // clarity and so a permission audit sees it granted, not inferred.
      "pos.loyalty.manage",
      "pos.loyalty.redeem",
      // F290: invoice generation/viewing, same tier as sale.create.
      "pos.invoice.generate",
      "pos.invoice.view",
      // F304: pos_manager is the resolve/approve authority for a
      // reconciliation variance -- deliberately NOT pos.reconciliation.manage
      // (see pos_supervisor below and the
      // pos_reconciliation_manage_approve SoD conflict), so the role that
      // generated/matched a reconciliation is never the same one that
      // resolves its exceptions.
      "pos.reconciliation.approve",
      "pos.reconciliation.view",
      // F305: posting/retrying a completed sale's GL entry.
      "pos.accounting.post",
      "pos.accounting.view",
      // F307
      "pos.analytics.view",
    ]),
  },
  {
    name: "POS Cashier",
    slug: "pos_cashier",
    description:
      "Least-privilege checkout operation: open/close an assigned shift, ring up sales, request returns. No overrides, no approvals, no store/terminal configuration.",
    moduleKey: "point-of-sale",
    riskLevel: "standard",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "stock.view",
      "pos.view",
      "pos.operate",
      "pos.shift.open",
      "pos.shift.close",
      "pos.sale.create",
      "pos.return.create",
      // F297/F298: a cashier's own terminal drains its local offline queue
      // against the server once back online.
      "pos.offline.sync",
      // F306: redeeming a customer's own points at checkout is a normal
      // checkout action, not a supervisor override — it sits alongside
      // pos.sale.create here, not with pos.loyalty.manage (program
      // configuration), which a cashier never holds.
      "pos.loyalty.redeem",
      // F290: generating/viewing an invoice for a sale the cashier just
      // rang up is a normal checkout-adjacent action, same tier as
      // sale.create/return.create.
      "pos.invoice.generate",
      "pos.invoice.view",
    ]),
  },
  {
    name: "POS Supervisor",
    slug: "pos_supervisor",
    description:
      "Store-floor override authority: approve returns, apply discounts and price overrides, adjust cash, view reports. Does not create returns itself and does not configure stores/terminals/settings.",
    moduleKey: "point-of-sale",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "stock.view",
      "stock.issue",
      "pos.view",
      "pos.operate",
      "pos.shift.open",
      "pos.shift.close",
      "pos.sale.create",
      "pos.discount.apply",
      // pos.return.create deliberately excluded — see pos_manager's comment
      // above; a supervisor approves, a cashier (or a supervisor also
      // holding pos_cashier) creates.
      "pos.return.approve",
      "pos.cash.adjust",
      "pos.price.override",
      "pos.payment.refund",
      "pos.reports.view",
      // F303: pos_supervisor generates/reviews the day-end (Z) report draft
      // — NOT pos.report.finalize (that's pos_manager's, a different
      // authority; see the pos_day_end_generate_finalize SoD conflict).
      "pos.report.generate",
      "pos.report.view",
      // F297/F298: a supervisor both syncs their own floor terminal's queue
      // and resolves conflicts other cashiers' syncs produced.
      "pos.offline.sync",
      "pos.offline.resolve",
      // F306: a supervisor can both configure the loyalty program (a
      // store-floor policy call, not a full pos.settings.manage-level
      // store/terminal change) and redeem points at checkout.
      "pos.loyalty.manage",
      "pos.loyalty.redeem",
      // F290: invoice generation/viewing.
      "pos.invoice.generate",
      "pos.invoice.view",
      // F304: pos_supervisor imports settlement evidence and
      // generates/matches a reconciliation — deliberately NOT
      // pos.reconciliation.approve (that's pos_manager's, a different
      // authority; see the pos_reconciliation_manage_approve SoD conflict).
      "pos.reconciliation.manage",
      "pos.reconciliation.view",
      // F307
      "pos.analytics.view",
    ]),
  },
  {
    name: "Quality Manager",
    slug: "quality_manager",
    description:
      "Quality plans, inspections, holds, non-conformance, CAPA, supplier quality and audits.",
    moduleKey: "quality",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "stock.view",
      "procurement.view",
      "manufacturing.view",
      "pos.view",
      "quality.view",
      "quality.manage",
      "quality.plan.manage",
      "quality.inspect",
      "quality.release",
      "quality.hold",
      "quality.nonconformance.manage",
      "quality.capa.manage",
      "quality.sampling.manage",
      "quality.supplier.manage",
      "quality.audit.manage",
      "quality.reports.view",
      "quality.settings.manage",
      "quality.audit.view",
    ]),
  },
  {
    name: "Support Manager",
    slug: "support_manager",
    description:
      "Tickets, queues, SLAs, escalation, knowledge base and customer communication.",
    moduleKey: "support",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "crm.view",
      "sales.view",
      "projects.view",
      "assets.view",
      "quality.view",
      "support.view",
      "support.manage",
      "support.ticket.create",
      "support.ticket.assign",
      "support.ticket.resolve",
      "support.ticket.close",
      "support.queue.manage",
      "support.sla.manage",
      "support.escalation.manage",
      "support.knowledge.manage",
      "support.communication.manage",
      "support.sensitive.view",
      "support.reports.view",
      "support.settings.manage",
      "support.audit.view",
    ]),
  },
  {
    name: "HR Manager",
    slug: "hr_manager",
    description:
      "Employees, attendance, leave, expenses, compensation, payroll, payslips and statutory controls.",
    moduleKey: "hr-payroll",
    riskLevel: "sensitive",
    assignable: true,
    permissions: unique([
      ...businessReader,
      "hr_payroll.view",
      "hr_payroll.employee.view",
      "hr_payroll.employee.manage",
      "hr_payroll.sensitive.view",
      "hr_payroll.attendance.manage",
      "hr_payroll.shift.manage",
      "hr_payroll.leave.manage",
      "hr_payroll.leave.approve",
      "hr_payroll.expense.manage",
      "hr_payroll.expense.approve",
      "hr_payroll.payroll.prepare",
      "hr_payroll.payroll.approve",
      "hr_payroll.payroll.post",
      "hr_payroll.payslip.view",
      "hr_payroll.compensation.manage",
      "hr_payroll.statutory.manage",
      "hr_payroll.reports.view",
      "hr_payroll.settings.manage",
      "hr_payroll.audit.view",
    ]),
  },
];

// The Customer Master permissions follow from what a role already does in
// Sales, by the same rules the migration that introduced them used for
// existing roles: whoever opens Sales sees customers; whoever writes
// quotations maintains them; approvers and Sales administrators control
// status, tax and commercial terms; finance users see the receivable figures.
const customerReader = ["sales.customers.view", "sales.customers.view_all", "sales.customers.addresses.view", "sales.customers.contacts.view"];
const customerWorker = [
  "sales.customers.create", "sales.customers.edit", "sales.customers.manage_addresses", "sales.customers.manage_contacts", "sales.customers.link_account",
  "sales.customers.addresses.inactivate", "sales.customers.addresses.set_default_billing", "sales.customers.addresses.set_default_shipping",
  "sales.customers.contacts.inactivate", "sales.customers.contacts.set_primary",
];
const customerManager = [
  ...customerWorker, "sales.customers.view_team", "sales.customers.inactivate", "sales.customers.reactivate", "sales.customers.block", "sales.customers.unblock",
  "sales.customers.delete", "sales.customers.import", "sales.customers.export", "sales.customers.edit_gstin", "sales.customers.change_currency",
  "sales.customers.change_payment_terms", "sales.customers.change_price_list", "sales.customers.view_financials", "sales.customers.addresses.edit_gstin",
];
// Products follow the same idea, by the rules of the migration that added
// them: whoever uses Sales, Procurement, Inventory or business data sees the
// catalogue; whoever maintains items, or administers Sales, maintains
// products; whoever sees margin
// or stock valuation sees cost.
const productMaintainer = [
  "products.create", "products.edit", "products.activate", "products.delete", "products.import", "products.export", "products.edit_pricing", "products.edit_tax",
  "products.edit_inventory",
];
function withProductPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  const cost = has("sales.margin.view") || has("stock.valuation.view");
  return {
    ...role,
    permissions: unique([
      ...role.permissions,
      ...(["sales.view", "procurement.view", "stock.view", "business_data.view", "items.manage"].some(has) ? ["products.view"] : []),
      // Sales administrators keep the catalogue they sell from.
      ...(has("items.manage") || has("sales.settings.manage") ? productMaintainer : []),
      ...(cost ? ["products.view_cost"] : []),
      ...(cost && has("items.manage") ? ["products.edit_cost"] : []),
    ]),
  };
}

function withCustomerPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  if (!has("sales.view")) return role;
  return {
    ...role,
    permissions: unique([
      ...role.permissions, ...customerReader,
      ...(has("sales.quotation.create") ? customerWorker : []),
      ...(has("sales.quotation.approve") || has("sales.settings.manage") ? customerManager : []),
      ...(has("accounting.view") ? ["sales.customers.view_financials"] : []),
    ]),
  };
}

// Price lists, by the rules of the migration that added their permissions:
// whoever opens Sales uses them; Sales administrators maintain them; whoever
// may override prices may export them.
const priceListMaintainer = [
  "sales.price_lists.create", "sales.price_lists.edit", "sales.price_lists.manage_prices", "sales.price_lists.activate", "sales.price_lists.set_default",
  "sales.price_lists.change_tax_mode", "sales.price_lists.import", "sales.price_lists.export",
];
function withPriceListPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  return {
    ...role,
    permissions: unique([
      ...role.permissions,
      ...(has("sales.view") ? ["sales.price_lists.view"] : []),
      ...(has("sales.settings.manage") ? priceListMaintainer : []),
      ...(has("sales.price.override") ? ["sales.price_lists.export"] : []),
    ]),
  };
}

// Quotations: everyone who opens Sales sees and prints quotations; whoever
// writes them confirms them; approvers and Sales administrators also see
// their team's and may date a quotation (as migration 0026 grants).
function withQuotationPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  return {
    ...role,
    permissions: unique([
      ...role.permissions,
      ...(has("sales.view") ? ["sales.quotation.view", "sales.quotation.view_all", "sales.quotation.export"] : []),
      ...(has("sales.quotation.create") ? ["sales.quotation.confirm"] : []),
      ...(has("sales.quotation.approve") || has("sales.settings.manage") ? ["sales.quotation.view_team", "sales.quotation.change_date", "sales.quotation.confirm"] : []),
    ]),
  };
}

// Discounts: whoever could discount (or override prices) gives line and
// document discounts; approvers go up to the higher limit; Sales
// administrators set the rules and are not limited by them (as migration 0027 grants).
function withDiscountPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  return {
    ...role,
    permissions: unique([
      ...role.permissions,
      ...(has("sales.discount.apply") || has("sales.price.override") ? ["sales.discount.apply", "sales.discount.apply_document"] : []),
      ...(has("sales.quotation.approve") || has("sales.settings.manage") ? ["sales.discount.apply_above_limit"] : []),
      ...(has("sales.settings.manage") ? ["sales.discount.override_limit", "sales.discount.manage_settings"] : []),
    ]),
  };
}

// Taxes: everyone who works with products, sales, the till or the books sees
// the tax set-up; finance manages it; finance and Sales administrators may
// override the tax on a document (as migration 0028 grants).
function withTaxPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  const finance = has("accounting.tax.manage") || has("accounting.settings.manage");
  return {
    ...role,
    permissions: unique([
      ...role.permissions,
      ...(has("sales.view") || has("products.view") || has("pos.view") || has("accounting.view") ? ["tax.view"] : []),
      ...(finance ? ["tax.categories.manage", "tax.rates.manage", "tax.registrations.manage"] : []),
      ...(finance || has("sales.settings.manage") ? ["tax.transaction.override", "tax.place_of_supply.override", "tax.audit.view"] : []),
    ]),
  };
}

// Sales orders: everyone who opens Sales sees and prints orders; whoever
// cancels orders may reopen them and cancel a remaining quantity; whoever
// confirms orders or delivers them reserves their stock; approvers and Sales
// administrators also see their team's (as migration 0029 grants).
function withOrderPermissions(role) {
  if (!Array.isArray(role.permissions)) return role;
  const has = (key) => role.permissions.includes(key);
  return {
    ...role,
    permissions: unique([
      ...role.permissions,
      ...(has("sales.view") ? ["sales.order.view", "sales.order.view_all", "sales.order.export"] : []),
      ...(has("sales.order.cancel") ? ["sales.order.reopen", "sales.order.cancel_remaining"] : []),
      ...(has("sales.order.confirm") || has("sales.fulfillment.request") ? ["sales.order.reserve"] : []),
      ...(has("sales.order.approve") || has("sales.settings.manage") ? ["sales.order.view_team"] : []),
      // Order confirmations: sent and acknowledged by whoever creates or confirms orders.
      ...(has("sales.order.create") || has("sales.order.confirm") ? ["sales.order.confirmation.send", "sales.order.confirmation.mark_sent", "sales.order.confirmation.acknowledge"] : []),
      ...(has("sales.order.cancel") ? ["sales.order.confirm_quote_variance"] : []),
      // Stock availability: seen by everyone who opens orders; the warehouse is changed by whoever reserves.
      ...(has("sales.view") ? ["sales.availability.view", "sales.availability.check", "sales.availability.other_warehouses"] : []),
      ...(has("sales.order.confirm") || has("sales.fulfillment.request") ? ["sales.order.change_warehouse"] : []),
      // Stock reservations: seen with the orders; released by whoever reserves; seen across orders by those who see every order or stock.
      ...(has("sales.view") ? ["sales.reservation.view"] : []),
      ...(has("sales.order.confirm") || has("sales.fulfillment.request") || has("sales.order.reserve") ? ["sales.reservation.release"] : []),
      ...(has("sales.view") || has("sales.order.view_all") || has("stock.view") ? ["sales.reservation.view_all"] : []),
    ]),
  };
}

export const ROLE_TEMPLATES = Object.freeze(
  ROLE_DEFINITIONS.map(withCustomerPermissions).map(withProductPermissions).map(withPriceListPermissions).map(withQuotationPermissions).map(withDiscountPermissions)
    .map(withTaxPermissions).map(withOrderPermissions),
);

export const ROLE_TEMPLATE_BY_SLUG = new Map(
  ROLE_TEMPLATES.map((template) => [template.slug, template]),
);

export function permissionsForRole(slug) {
  return [...(ROLE_TEMPLATE_BY_SLUG.get(slug)?.permissions || businessReader)];
}

export const SOD_CONFLICTS = Object.freeze([
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
    key: "pos_return_create_approve",
    first: "pos.return.create",
    second: "pos.return.approve",
    severity: "blocking",
    description:
      "POS return creation and approval must be separated — the same role must not both request and approve a store return/refund.",
  },
  {
    key: "pos_discount_apply_approve",
    first: "pos.discount.apply",
    second: "pos.discount.approve",
    severity: "blocking",
    description:
      "POS discount application and approval must be separated — the same role must not both apply an above-threshold discount and approve it.",
  },
  {
    key: "pos_day_end_generate_finalize",
    first: "pos.report.generate",
    second: "pos.report.finalize",
    severity: "blocking",
    description:
      "POS day-end (Z) report generation/review and finalization must be separated — the same role must not both draft and lock the same immutable report.",
  },
  {
    key: "pos_reconciliation_manage_approve",
    first: "pos.reconciliation.manage",
    second: "pos.reconciliation.approve",
    severity: "blocking",
    description:
      "POS payment reconciliation generation/matching and exception approval must be separated — the same role must not both match settlement evidence and resolve its own variance.",
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
]);

export function analyzePermissionConflicts(permissionKeys) {
  const set = new Set(permissionKeys);
  return SOD_CONFLICTS.filter(
    (conflict) => set.has(conflict.first) && set.has(conflict.second),
  );
}

export function permissionsOutsideGrantCeiling(
  actorRoleSlugs,
  actorPermissions,
  requestedPermissions,
) {
  if (actorRoleSlugs.includes("organization_owner")) return [];
  const available = new Set(actorPermissions);
  return unique(requestedPermissions).filter(
    (permission) => !available.has(permission),
  );
}

export function roleIsAvailable(moduleKey, assignable, enabledModules) {
  if (!assignable) return false;
  if (!moduleKey || moduleKey === "platform") return true;
  return enabledModules.includes(moduleKey);
}

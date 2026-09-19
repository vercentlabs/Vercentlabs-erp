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

function unique(values) {
  return [...new Set(values)];
}

export const ROLE_TEMPLATES = Object.freeze([
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
        ![
          "billing.manage",
          "billing.checkout",
          "billing.audit",
          "integrations.manage",
          "platform.configuration.manage",
          "platform.extensibility.manage",
          "platform.privacy.manage",
          "platform.reports.manage",
          "platform.ai.manage",
          "platform.workflows.manage",
          "platform.security.manage",
        ].includes(key),
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
      "crm.records.view_all",
      "parties.manage",
      "crm.leads.manage",
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
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
      "automation.view",
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
      "crm.records.view_all",
      "approvals.manage",
      "parties.manage",
      "crm.leads.manage",
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
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
      "crm.records.view_all",
      "approvals.manage",
      "parties.manage",
      "crm.leads.manage",
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
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
      "crm.leads.view_sensitive",
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
      "crm.records.view_all",
      "parties.manage",
      "crm.leads.manage",
      "crm.leads.view_sensitive",
      "crm.saved_views.share",
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
      "crm.records.view_all",
      "parties.manage",
      "crm.leads.manage",
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
      "crm.records.view_all",
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
      "crm.records.view_all",
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
]);

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

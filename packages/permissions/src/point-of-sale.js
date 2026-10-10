export const POS_PERMISSIONS = Object.freeze({
  view: "pos.view",
  operate: "pos.operate",
  shiftOpen: "pos.shift.open",
  shiftClose: "pos.shift.close",
  saleCreate: "pos.sale.create",
  discountApply: "pos.discount.apply",
  discountApprove: "pos.discount.approve",
  returnCreate: "pos.return.create",
  returnApprove: "pos.return.approve",
  cashAdjust: "pos.cash.adjust",
  priceOverride: "pos.price.override",
  terminalManage: "pos.terminal.manage",
  storeManage: "pos.store.manage",
  paymentManage: "pos.payment.manage",
  // F283/F284/F285/F286 payment-tender subsystem. paymentManage already
  // covers provider/config administration (which adapter is active per
  // store). These two are the operational actions that need their own,
  // narrower grants: refunding a captured payment back to its original
  // tender, and requesting a manual force-capture override when a
  // provider is unreachable (e.g. terminal offline) -- the override
  // ALWAYS still requires a separate approver via the real maker-checker
  // engine (services/api/src/core/approvals.js); this permission only
  // gates who may REQUEST one, never who may decide it (deciding is
  // gated by holding this same permission AND not being the requester --
  // see assertSeparationOfDuties in decideApproval).
  paymentRefund: "pos.payment.refund",
  paymentOverride: "pos.payment.override",
  // F303: day-end/Z report generation, review and finalization. Deliberately
  // separate from the pre-existing pos.reports.view (routine ad hoc
  // reporting) — pos.report.view gates the immutable, numbered Z report
  // record itself. generate/finalize are split across two different role
  // tiers on purpose (see roles.js's pos_supervisor/pos_manager grants and
  // the pos_day_end_generate_finalize SoD conflict below): the person who
  // computes/reviews a draft is never the same authority who locks it.
  reportGenerate: "pos.report.generate",
  reportFinalize: "pos.report.finalize",
  reportView: "pos.report.view",
  reportsView: "pos.reports.view",
  settingsManage: "pos.settings.manage",
  auditView: "pos.audit.view",
  // F297/F298 (offline POS workspace + offline-to-online sync): syncing a
  // device's own queued offline sales is distinct from resolving a
  // conflict another cashier's sync produced, matching the
  // create/approve-style separation already used for returns.
  offlineSync: "pos.offline.sync",
  offlineResolve: "pos.offline.resolve",
  loyaltyManage: "pos.loyalty.manage",
  loyaltyRedeem: "pos.loyalty.redeem",
  // F290: producing/viewing a formal tax invoice for a completed sale is a
  // normal checkout-adjacent action, same tier as saleCreate.
  invoiceGenerate: "pos.invoice.generate",
  invoiceView: "pos.invoice.view",
  // F304: a genuine maker-checker split, mirroring reportGenerate/
  // reportFinalize -- the role that imports settlement evidence and
  // generates/matches a reconciliation is never the same role that
  // resolves its variance exceptions (see the
  // pos_reconciliation_manage_approve SoD conflict below).
  reconciliationManage: "pos.reconciliation.manage",
  reconciliationApprove: "pos.reconciliation.approve",
  reconciliationView: "pos.reconciliation.view",
  // F305: triggering/retrying a GL posting is a sensitive financial-system
  // action, same tier as settingsManage.
  accountingPost: "pos.accounting.post",
  accountingView: "pos.accounting.view",
  // F307
  analyticsView: "pos.analytics.view",
});

// Stores & Outlets (migration 0080): the outlet master, its stock source, tax and documents, payment methods, who works there, and what
// happened there. Granted from pos.view (view), pos.store.manage (maintain, stock source, access, transactions and sessions),
// pos.settings.manage (tax, payments, finance) and pos.reports.view / pos.report.view (transactions and sessions).
export const POS_OUTLET_PERMISSIONS = Object.freeze({
  view: "pos.outlets.view",
  create: "pos.outlets.create",
  edit: "pos.outlets.edit",
  status: "pos.outlets.status",
  manageInventory: "pos.outlets.manage_inventory",
  manageTax: "pos.outlets.manage_tax",
  managePayments: "pos.outlets.manage_payments",
  manageAccess: "pos.outlets.manage_access",
  viewTransactions: "pos.outlets.view_transactions",
  viewSessions: "pos.outlets.view_sessions",
  viewFinance: "pos.outlets.view_finance",
});

// POS Terminals (migration 0081): a register inside an outlet. Granted from pos.view (view), pos.terminal.manage (maintain, location,
// numbering, hardware, sessions and transactions), pos.settings.manage (cash and payments) and pos.reports.view / pos.report.view (sessions
// and transactions). Operating a terminal stays pos.operate / pos.shift.open with access to its outlet.
export const POS_TERMINAL_PERMISSIONS = Object.freeze({
  view: "pos.terminals.view",
  create: "pos.terminals.create",
  edit: "pos.terminals.edit",
  status: "pos.terminals.status",
  configureInventory: "pos.terminals.configure_inventory",
  configureCash: "pos.terminals.configure_cash",
  configurePayments: "pos.terminals.configure_payments",
  configureNumbering: "pos.terminals.configure_numbering",
  configureHardware: "pos.terminals.configure_hardware",
  viewSessions: "pos.terminals.view_sessions",
  viewTransactions: "pos.terminals.view_transactions",
});

// Cashiers (migration 0082): the POS profile over a workspace user — where they may work, and what they did. Granted from pos.view (view),
// pos.store.manage (maintain, outlets, sessions, transactions), pos.reports.view / pos.report.view (sessions and transactions) and
// pos.outlets.view_finance / pos.settings.manage (cash details). Operating POS stays pos.operate / pos.shift.open / pos.sale.create.
export const POS_CASHIER_PERMISSIONS = Object.freeze({
  view: "pos.cashiers.view",
  create: "pos.cashiers.create",
  edit: "pos.cashiers.edit",
  status: "pos.cashiers.status",
  assignOutlets: "pos.cashiers.assign_outlets",
  viewSessions: "pos.cashiers.view_sessions",
  viewTransactions: "pos.cashiers.view_transactions",
  viewCash: "pos.cashiers.view_cash",
});

// Cashier Permissions (migration 0083): who administers the permission profiles that decide what cashiers may do. These are ERP
// administration permissions; what a cashier may do at a POS is their profile's grants, not a role. Granted from pos.settings.manage (all)
// and pos.store.manage (view and assign).
export const POS_PERMISSION_PROFILE_PERMISSIONS = Object.freeze({
  view: "pos.permission_profiles.view",
  manage: "pos.permission_profiles.manage",
  status: "pos.permission_profiles.status",
  assign: "pos.permission_profiles.assign",
  configureUnlimited: "pos.permission_profiles.configure_unlimited",
  viewHistory: "pos.permission_profiles.view_history",
});

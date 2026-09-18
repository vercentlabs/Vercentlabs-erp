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
});

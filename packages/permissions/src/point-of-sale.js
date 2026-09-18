export const POS_PERMISSIONS = Object.freeze({
  view: "pos.view",
  operate: "pos.operate",
  shiftOpen: "pos.shift.open",
  shiftClose: "pos.shift.close",
  saleCreate: "pos.sale.create",
  discountApply: "pos.discount.apply",
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
  reportsView: "pos.reports.view",
  settingsManage: "pos.settings.manage",
  auditView: "pos.audit.view",
});

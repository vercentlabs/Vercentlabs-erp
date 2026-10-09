export const STOCK_PERMISSIONS = Object.freeze({
  view: "stock.view",
  manage: "stock.manage",
  receive: "stock.receive",
  issue: "stock.issue",
  transfer: "stock.transfer",
  adjust: "stock.adjust",
  reserve: "stock.reserve",
  count: "stock.count",
  valuationView: "stock.valuation.view",
  reportsView: "stock.reports.view",
  settingsManage: "stock.settings.manage",
  auditView: "stock.audit.view",
  opening: "stock.opening",
  backdate: "stock.backdate",
  rebuildBalances: "stock.balance.rebuild",
  releaseReservation: "stock.reservation.release",
  reallocateReservation: "stock.reservation.reallocate",
});

// Quality Holds (quarantine / quality-held stock): placing stock on quality hold and in quarantine, releasing each (quarantine needs the stronger
// permission), partial release, escalation, moving to damaged, batch and serial stock, reservation conflicts, history, value and reasons.
export const STOCK_HOLD_PERMISSIONS = Object.freeze({
  view: "stock.holds.view", create: "stock.holds.create", editDraft: "stock.holds.edit_draft", place: "stock.holds.place", placeQuarantine: "stock.holds.place_quarantine",
  release: "stock.holds.release", releaseQuarantine: "stock.holds.release_quarantine", partialRelease: "stock.holds.partial_release", escalate: "stock.holds.escalate",
  damage: "stock.holds.damage", batch: "stock.holds.batch", serial: "stock.holds.serial", resolveReservations: "stock.holds.resolve_reservations",
  viewHistory: "stock.holds.view_history", viewValue: "stock.holds.view_value", manageReasons: "stock.holds.manage_reasons",
});

// Reorder Level / Replenishment: rules and requirements are seen with stock; rules are kept by inventory set-up; purchase drafts are opened by
// buyers and transfer drafts by those who create transfers. Nothing here moves stock or commits a purchase.
export const STOCK_REORDER_PERMISSIONS = Object.freeze({
  view: "stock.reorder.view", viewRequirements: "stock.reorder.view_requirements", create: "stock.reorder.create", edit: "stock.reorder.edit",
  disable: "stock.reorder.disable", import: "stock.reorder.import", viewDemand: "stock.reorder.view_demand", viewIncoming: "stock.reorder.view_incoming",
  viewOtherStock: "stock.reorder.view_other_stock", createPurchaseDraft: "stock.reorder.create_purchase_draft", createTransferDraft: "stock.reorder.create_transfer_draft",
  dismiss: "stock.reorder.dismiss", export: "stock.reorder.export",
});

// Low-Stock Alerts: seen (and notified) with stock; acknowledged by those who act on stock, buy or transfer; history with stock; export by
// inventory set-up and buyers. Acting on an alert uses the Replenishment permissions.
export const STOCK_ALERT_PERMISSIONS = Object.freeze({
  view: "stock.alerts.view", acknowledge: "stock.alerts.acknowledge", viewHistory: "stock.alerts.view_history", export: "stock.alerts.export",
});

// Inventory Valuation: values are seen with stock value (stock.valuation.view); rates, FIFO layers, value movements (COGS), cost sources and
// exchange rates each need their own permission; so do choosing an item's method (before history), reconciliation, the GL comparison, the
// rebuild (administrators) and exports.
export const STOCK_VALUATION_PERMISSIONS = Object.freeze({
  view: "stock.valuation.view", viewRate: "stock.valuation.view_rate", viewLayers: "stock.valuation.view_layers", viewMovements: "stock.valuation.view_movements",
  viewCostSource: "stock.valuation.view_cost_source", viewExchangeRate: "stock.valuation.view_exchange_rate", configureMethod: "stock.valuation.configure_method",
  reconcileView: "stock.valuation.reconcile_view", reconcileRun: "stock.valuation.reconcile_run", rebuild: "stock.valuation.rebuild",
  financeReconcile: "stock.valuation.finance_reconcile", export: "stock.valuation.export",
});

// Negative-Stock Control: warnings are seen with stock; the exception report, its export, the audit, the company policy and the item-level block
// each need their own permission. Overriding (an untracked issue beyond the stock on hand) is granted to no role by default.
export const NEGATIVE_STOCK_PERMISSIONS = Object.freeze({
  viewWarnings: "stock.negative.view_warnings", viewExceptions: "stock.negative.view_exceptions", override: "stock.negative.override",
  viewAudit: "stock.negative.view_audit", configure: "stock.negative.configure", itemBlock: "stock.negative.item_block", export: "stock.negative.export",
});

// Physical Inventory / Stock Count: counters count (quantities, batches, serial numbers, unexpected stock, imports) and submit; inventory managers
// create, scope, start, review, request recounts and complete; the system quantity of a blind count, values, reservation conflicts and cancelling a
// started count each need their own permission.
export const STOCK_COUNT_PERMISSIONS = Object.freeze({
  view: "stock.counts.view", create: "stock.counts.create", configure: "stock.counts.configure", start: "stock.counts.start", count: "stock.counts.count",
  countBatch: "stock.counts.count_batch", countSerial: "stock.counts.count_serial", addUnexpected: "stock.counts.add_unexpected", import: "stock.counts.import",
  submit: "stock.counts.submit", requestRecount: "stock.counts.request_recount", recount: "stock.counts.recount", review: "stock.counts.review",
  viewSystemQuantity: "stock.counts.view_system_quantity", viewValue: "stock.counts.view_value", resolveReservations: "stock.counts.resolve_reservations",
  complete: "stock.counts.complete", cancel: "stock.counts.cancel", export: "stock.counts.export", viewHistory: "stock.counts.view_history",
});

// Stock Reservations: the reservation records behind Reserved Stock. Viewing, the source breakdown and the exact allocations; reserving for purchase
// returns; moving a reservation to another warehouse (another location, batch or serial is stock.reservation.reallocate); working exceptions;
// reconciling; rebuilding the projection. Sales and transfers reserve with their own document permissions.
export const STOCK_RESERVATION_PERMISSIONS = Object.freeze({
  view: "stock.reservations.view",
  viewSources: "stock.reservations.view_sources",
  viewAllocations: "stock.reservations.view_allocations",
  reservePurchaseReturn: "stock.reservations.reserve_purchase_return",
  reallocateWarehouse: "stock.reservations.reallocate_warehouse",
  reallocate: "stock.reservation.reallocate",
  release: "stock.reservation.release",
  resolveExceptions: "stock.reservations.resolve_exceptions",
  reconcile: "stock.reservations.reconcile",
  rebuild: "stock.reservations.rebuild",
});

// Goods Issues: stock deliberately taken out of inventory for a known internal purpose. Preparing, posting, reversing, issuing restricted stock,
// scrap and disposal, seeing value and configuring reasons are separate.
export const GOODS_ISSUE_PERMISSIONS = Object.freeze({
  view: "stock.goods_issue.view",
  create: "stock.goods_issue.create",
  post: "stock.goods_issue.post",
  reverse: "stock.goods_issue.reverse",
  issueRestricted: "stock.goods_issue.issue_restricted",
  dispose: "stock.goods_issue.dispose",
  viewCost: "stock.goods_issue.view_cost",
  manageReasons: "stock.goods_issue.manage_reasons",
});

// Internal Transfers: preparing, confirming (reserving), dispatching, receiving, moving restricted stock, writing off transit losses, reversing
// and exporting are separate; warehouse access decides where each step may be done.
export const STOCK_TRANSFER_PERMISSIONS = Object.freeze({
  view: "stock.transfers.view",
  create: "stock.transfers.create",
  confirm: "stock.transfers.confirm",
  dispatch: "stock.transfers.dispatch",
  receive: "stock.transfers.receive",
  restricted: "stock.transfers.restricted",
  writeOff: "stock.transfers.write_off",
  reverse: "stock.transfers.reverse",
  export: "stock.transfers.export",
});

// Stock Adjustments: the one document that corrects recorded stock to what physically exists. Prepared and counted by inventory staff, posted
// (increases and decreases separately) by inventory managers; large values, reservation conflicts, entered or zero costs, backdating,
// reversal and the reason master need stronger permissions.
export const STOCK_ADJUSTMENT_PERMISSIONS = Object.freeze({
  view: "stock.adjustments.view",
  create: "stock.adjustments.create",
  edit: "stock.adjustments.edit",
  count: "stock.adjustments.count",
  postIncrease: "stock.adjustments.post_increase",
  postDecrease: "stock.adjustments.post_decrease",
  postLarge: "stock.adjustments.post_large",
  restricted: "stock.adjustments.restricted",
  batch: "stock.adjustments.batch",
  serial: "stock.adjustments.serial",
  resolveReservations: "stock.adjustments.resolve_reservations",
  manualCost: "stock.adjustments.manual_cost",
  zeroCost: "stock.adjustments.zero_cost",
  backdate: "stock.adjustments.backdate",
  reverse: "stock.adjustments.reverse",
  viewCost: "stock.adjustments.view_cost",
  viewAccounting: "stock.adjustments.view_accounting",
  manageReasons: "stock.adjustments.manage_reasons",
});

// Stock Ledger: the immutable history of every physical movement. Quantities are seen with View; cost and value, export and reconciliation
// each need their own permission. There is no permission to edit the ledger: corrections are compensating movements.
export const STOCK_LEDGER_PERMISSIONS = Object.freeze({
  view: "stock.ledger.view",
  viewCost: "stock.ledger.view_cost",
  export: "stock.ledger.export",
  reconcile: "stock.ledger.reconcile",
});

// Opening Stock: the controlled document that brings in stock owned before Vercentlabs. Preparing drafts (stock.opening) and posting them
// are separate; cost is seen and entered only with its own permissions.
export const OPENING_STOCK_PERMISSIONS = Object.freeze({
  view: "stock.opening.view",
  prepare: "stock.opening",
  viewCost: "stock.opening.view_cost",
  editCost: "stock.opening.edit_cost",
  post: "stock.opening.post",
  reverse: "stock.opening.reverse",
  zeroCost: "stock.opening.zero_cost",
  backdate: "stock.opening.backdate",
  reconcile: "stock.opening.reconcile",
});

// The warehouse master and who may work in which warehouse.
export const WAREHOUSE_PERMISSIONS = Object.freeze({
  view: "warehouses.view",
  create: "warehouses.create",
  edit: "warehouses.edit",
  changeCode: "warehouses.change_code",
  status: "warehouses.status",
  manageLocations: "warehouses.manage_locations",
  manageAccess: "warehouses.manage_access",
  viewStock: "warehouses.view_stock",
  viewValue: "warehouses.view_value",
});

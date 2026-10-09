export declare const STOCK_PERMISSIONS: Readonly<Record<string, string>>;
export declare const OPENING_STOCK_PERMISSIONS: Readonly<{
  view: "stock.opening.view"; prepare: "stock.opening"; viewCost: "stock.opening.view_cost"; editCost: "stock.opening.edit_cost"; post: "stock.opening.post";
  reverse: "stock.opening.reverse"; zeroCost: "stock.opening.zero_cost"; backdate: "stock.opening.backdate"; reconcile: "stock.opening.reconcile";
}>;
export declare const WAREHOUSE_PERMISSIONS: Readonly<{
  view: "warehouses.view"; create: "warehouses.create"; edit: "warehouses.edit"; changeCode: "warehouses.change_code"; status: "warehouses.status";
  manageLocations: "warehouses.manage_locations"; manageAccess: "warehouses.manage_access"; viewStock: "warehouses.view_stock"; viewValue: "warehouses.view_value";
}>;
export declare const STOCK_LEDGER_PERMISSIONS: Readonly<{
  view: "stock.ledger.view"; viewCost: "stock.ledger.view_cost"; export: "stock.ledger.export"; reconcile: "stock.ledger.reconcile";
}>;
export declare const GOODS_ISSUE_PERMISSIONS: Readonly<{
  view: "stock.goods_issue.view"; create: "stock.goods_issue.create"; post: "stock.goods_issue.post"; reverse: "stock.goods_issue.reverse";
  issueRestricted: "stock.goods_issue.issue_restricted"; dispose: "stock.goods_issue.dispose"; viewCost: "stock.goods_issue.view_cost"; manageReasons: "stock.goods_issue.manage_reasons";
}>;
export declare const STOCK_TRANSFER_PERMISSIONS: Readonly<{
  view: "stock.transfers.view"; create: "stock.transfers.create"; confirm: "stock.transfers.confirm"; dispatch: "stock.transfers.dispatch"; receive: "stock.transfers.receive";
  restricted: "stock.transfers.restricted"; writeOff: "stock.transfers.write_off"; reverse: "stock.transfers.reverse"; export: "stock.transfers.export";
}>;
export declare const STOCK_ADJUSTMENT_PERMISSIONS: Readonly<{
  view: "stock.adjustments.view"; create: "stock.adjustments.create"; edit: "stock.adjustments.edit"; count: "stock.adjustments.count";
  postIncrease: "stock.adjustments.post_increase"; postDecrease: "stock.adjustments.post_decrease"; postLarge: "stock.adjustments.post_large";
  restricted: "stock.adjustments.restricted"; batch: "stock.adjustments.batch"; serial: "stock.adjustments.serial"; resolveReservations: "stock.adjustments.resolve_reservations";
  manualCost: "stock.adjustments.manual_cost"; zeroCost: "stock.adjustments.zero_cost"; backdate: "stock.adjustments.backdate"; reverse: "stock.adjustments.reverse";
  viewCost: "stock.adjustments.view_cost"; viewAccounting: "stock.adjustments.view_accounting"; manageReasons: "stock.adjustments.manage_reasons";
}>;
export declare const STOCK_RESERVATION_PERMISSIONS: Readonly<{
  view: "stock.reservations.view"; viewSources: "stock.reservations.view_sources"; viewAllocations: "stock.reservations.view_allocations";
  reservePurchaseReturn: "stock.reservations.reserve_purchase_return"; reallocateWarehouse: "stock.reservations.reallocate_warehouse"; reallocate: "stock.reservation.reallocate";
  release: "stock.reservation.release"; resolveExceptions: "stock.reservations.resolve_exceptions"; reconcile: "stock.reservations.reconcile"; rebuild: "stock.reservations.rebuild";
}>;
export declare const STOCK_HOLD_PERMISSIONS: Readonly<{
  view: "stock.holds.view"; create: "stock.holds.create"; editDraft: "stock.holds.edit_draft"; place: "stock.holds.place"; placeQuarantine: "stock.holds.place_quarantine";
  release: "stock.holds.release"; releaseQuarantine: "stock.holds.release_quarantine"; partialRelease: "stock.holds.partial_release"; escalate: "stock.holds.escalate";
  damage: "stock.holds.damage"; batch: "stock.holds.batch"; serial: "stock.holds.serial"; resolveReservations: "stock.holds.resolve_reservations";
  viewHistory: "stock.holds.view_history"; viewValue: "stock.holds.view_value"; manageReasons: "stock.holds.manage_reasons";
}>;
export declare const STOCK_VALUATION_PERMISSIONS: Readonly<{
  view: "stock.valuation.view"; viewRate: "stock.valuation.view_rate"; viewLayers: "stock.valuation.view_layers"; viewMovements: "stock.valuation.view_movements";
  viewCostSource: "stock.valuation.view_cost_source"; viewExchangeRate: "stock.valuation.view_exchange_rate"; configureMethod: "stock.valuation.configure_method";
  reconcileView: "stock.valuation.reconcile_view"; reconcileRun: "stock.valuation.reconcile_run"; rebuild: "stock.valuation.rebuild";
  financeReconcile: "stock.valuation.finance_reconcile"; export: "stock.valuation.export";
}>;
export declare const NEGATIVE_STOCK_PERMISSIONS: Readonly<{
  viewWarnings: "stock.negative.view_warnings"; viewExceptions: "stock.negative.view_exceptions"; override: "stock.negative.override";
  viewAudit: "stock.negative.view_audit"; configure: "stock.negative.configure"; itemBlock: "stock.negative.item_block"; export: "stock.negative.export";
}>;
export declare const STOCK_COUNT_PERMISSIONS: Readonly<{
  view: "stock.counts.view"; create: "stock.counts.create"; configure: "stock.counts.configure"; start: "stock.counts.start"; count: "stock.counts.count";
  countBatch: "stock.counts.count_batch"; countSerial: "stock.counts.count_serial"; addUnexpected: "stock.counts.add_unexpected"; import: "stock.counts.import";
  submit: "stock.counts.submit"; requestRecount: "stock.counts.request_recount"; recount: "stock.counts.recount"; review: "stock.counts.review";
  viewSystemQuantity: "stock.counts.view_system_quantity"; viewValue: "stock.counts.view_value"; resolveReservations: "stock.counts.resolve_reservations";
  complete: "stock.counts.complete"; cancel: "stock.counts.cancel"; export: "stock.counts.export"; viewHistory: "stock.counts.view_history";
}>;
export declare const STOCK_REORDER_PERMISSIONS: Readonly<{
  view: "stock.reorder.view"; viewRequirements: "stock.reorder.view_requirements"; create: "stock.reorder.create"; edit: "stock.reorder.edit";
  disable: "stock.reorder.disable"; import: "stock.reorder.import"; viewDemand: "stock.reorder.view_demand"; viewIncoming: "stock.reorder.view_incoming";
  viewOtherStock: "stock.reorder.view_other_stock"; createPurchaseDraft: "stock.reorder.create_purchase_draft"; createTransferDraft: "stock.reorder.create_transfer_draft";
  dismiss: "stock.reorder.dismiss"; export: "stock.reorder.export";
}>;
export declare const STOCK_ALERT_PERMISSIONS: Readonly<{
  view: "stock.alerts.view"; acknowledge: "stock.alerts.acknowledge"; viewHistory: "stock.alerts.view_history"; export: "stock.alerts.export";
}>;

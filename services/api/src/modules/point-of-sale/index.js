// Stable public POS API boundary. Implementation is owned by the nine
// canonical POS-CAP-00x capability directories (docs/02-register/
// CAPABILITY_REGISTER.csv), plus shared/ for cross-cutting infrastructure
// (error factory, permission/store-access checks, the audit event writer,
// and the generic multi-resource list) that has no single capability
// owner -- mirroring services/api/src/modules/crm/index.js's own "implementation
// is owned by the capability directories" boundary.
export { getPointOfSaleDashboard } from "./pos-analytics/dashboard.js";

export { listPointOfSaleResource } from "./shared/resource-registry.js";

// POS-CAP-001 -- store, terminal and cashier control (F268-F271).
export { listPosStoreSetupOptions, createStore, updatePosStore, setPosStoreActive } from "./store-terminal-and-cashier-control/store-operations.js";
export { createTerminal, updatePosTerminal, setPosTerminalStatus } from "./store-terminal-and-cashier-control/terminal-operations.js";
export { listPosEligibleCashiers, listPosStoreAccess, grantPosStoreAccess, revokePosStoreAccess } from "./store-terminal-and-cashier-control/cashier-access.js";
// Company POS policy and per-store payment methods/providers -- the
// configuration checkout, returns and tender already READ (POS-CAP-001 / -003).
export {
  getPosSettings,
  updatePosSettings,
  getPosStorePaymentConfig,
  setPosStorePaymentConfig,
  POS_SETTINGS_DEFAULTS,
} from "./store-terminal-and-cashier-control/settings-and-payment-config.js";

// POS-CAP-002 -- assortment, pricing, customer and cart (F272-F281).
export { searchPointOfSalePosProducts, lookupPointOfSaleBarcode } from "./assortment-pricing-customer-and-cart/assortment.js";
export { searchPointOfSaleCustomers } from "./assortment-pricing-customer-and-cart/customers.js";
export { priceCartLines } from "./assortment-pricing-customer-and-cart/cart-pricing.js";
export {
  createPosCart,
  getPosCart,
  addPosCartLine,
  updatePosCartLineQuantity,
  removePosCartLine,
  setPosCartLineTracking,
  applyPosCartLineDiscount,
  removePosCartLineDiscount,
  setPosCartDiscount,
  assertPosCartDiscountsApproved,
  approvePosCartDiscountApproval,
  rejectPosCartDiscountApproval,
  setPosCartCustomer,
  holdPosCart,
  resumePosCart,
  listHeldPosCarts,
  listPosDiscountApprovals,
  cancelPosCart,
} from "./assortment-pricing-customer-and-cart/cart.js";
// Exported publicly (not just used internally by sale-completion.js/
// return-lifecycle.js) because it commits loyalty effects idempotently on
// the sale id.
export { commitPosLoyaltyForSale } from "./assortment-pricing-customer-and-cart/loyalty.js";
export { completePointOfSale, completePosCart } from "./assortment-pricing-customer-and-cart/sale-completion.js";

// POS-CAP-003 -- tender and payment execution (F282-F286).
export {
  initiatePosPayment,
  getPosPaymentStatus,
  voidPosPayment,
  refundPosPayment,
  requestPosPaymentOverride,
  approvePosPaymentOverride,
  rejectPosPaymentOverrideApproval,
  handlePosPaymentWebhook,
  resolvePaymentAdapter,
  PaymentAdapterError,
} from "./tender-and-payment-execution/payments.js";

// POS-CAP-004 -- transaction continuity and documents (F287-F290).
export { getPosSaleReceipt, recordPosReceiptPrintAttempt, listPosReceiptPrintEvents } from "./transaction-continuity-and-documents/receipts.js";
// Transactions workspace — search/drill-down over completed sales. Same
// capability directory as receipts: a completed sale IS the
// transaction this reads, just a richer, filterable/paginated view of it.
export { listPosTransactions, getPosTransactionDetail } from "./transaction-continuity-and-documents/transactions.js";

// POS-CAP-005 -- returns, refunds and exchanges (F291-F293).
export { findPosSaleForReturn } from "./returns-refunds-and-exchanges/returns.js";
export { createPointOfSaleReturn, approvePointOfSaleReturn, completePointOfSaleReturn } from "./returns-refunds-and-exchanges/return-lifecycle.js";

// POS-CAP-007 -- cash, shift, day-end and reconciliation (F299-F305).
export { openShift, closeShift, getPosShift } from "./cash-shift-day-end-and-reconciliation/shift-operations.js";
export { recordPosCashMovement, listPosCashMovements } from "./cash-shift-day-end-and-reconciliation/cash-movements.js";
export {
  generatePosDayEndReport,
  reviewPosDayEndReport,
  finalizePosDayEndReport,
  recordPosDayEndVariance,
  listPosDayEndReports,
  getPosDayEndReport,
} from "./cash-shift-day-end-and-reconciliation/day-end-reports.js";
export {
  importPosSettlementBatch,
  generatePosReconciliation,
  resolvePosReconciliation,
  recordPosReconciliationCorrection,
  listPosReconciliations,
  getPosReconciliation,
} from "./cash-shift-day-end-and-reconciliation/reconciliation.js";
export {
  postPosSaleToAccounting,
  postPosReturnToAccounting,
  postPosDayEndReportToAccounting,
  listPosAccountingPostingQueue,
} from "./cash-shift-day-end-and-reconciliation/accounting-posting.js";
export {
  POS_MAPPING_KEYS,
  getPosAccountingMappingConfig,
  upsertPosAccountingMapping,
} from "./cash-shift-day-end-and-reconciliation/accounting-mapping-config.js";

// POS-CAP-006 -- inventory visibility (F294-F296).
// F294/F296 -- read-only store inventory/stock-sync-activity visibility,
// sourced directly from Stock's own ledger (see that file's own header
// comment for why this never writes stock_balances/stock_movements).
export { listPosStoreInventory, listPosStoreStockActivity } from "./inventory-and-offline-continuity/inventory-visibility.js";

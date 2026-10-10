// Stable public POS API boundary. Implementation is owned by the nine
// POS-CAP-00x capability directories, plus shared/ for cross-cutting infrastructure
// (error factory, permission/store-access checks, the audit event writer,
// and the generic multi-resource list) that has no single capability
// owner -- mirroring services/api/src/modules/crm/index.js's own "implementation
// is owned by the capability directories" boundary.
export { getPointOfSaleDashboard } from "./pos-analytics/dashboard.js";
export { getWalkInSalesSummary } from "./pos-analytics/walk-in.js";

export { listPointOfSaleResource } from "./shared/resource-registry.js";

// Stores & Outlets -- the selling location every POS transaction belongs to (migration 0080).
export {
  PosOutletError,
  OUTLET_TYPES,
  OUTLET_PAYMENT_METHODS,
  normalizeOutletCode,
  outletCapabilities,
  listOutlets,
  getOutlet,
  getOutletOptions,
  createOutlet,
  updateOutlet,
  validateOutletSetup,
  validateOutletForDeactivation,
  setOutletStatus,
  deleteOutlet,
  getOutletPaymentMethods,
  configureOutletPaymentMethods,
  isOutletPaymentMethodEnabled,
  getOutletAccess,
  getOutletInventorySummary,
  getOutletTerminals,
  getOutletSessions,
  getOutletTransactions,
  getOutletHistory,
} from "./outlets/index.js";

// POS Terminals -- the registers inside an outlet (migration 0081).
export {
  PosTerminalError,
  normalizeTerminalCode,
  terminalCapabilities,
  listTerminals,
  getTerminal,
  getTerminalOptions,
  createTerminal,
  updateTerminal,
  validateTerminalSetup,
  validateTerminalForDeactivation,
  setTerminalStatus,
  deleteTerminal,
  getEffectiveTerminalConfiguration,
  isTerminalPaymentMethodEnabled,
  resolveTerminalStockSource,
  validateTerminalOperationAccess,
  openPosForTerminal,
  assertTerminalCanOpenSession,
  getTerminalSessions,
  getCurrentTerminalSession,
  getTerminalTransactions,
  getTerminalHistory,
} from "./terminals/index.js";

// Cashier Permissions -- what a cashier may do, within which limits, and supervisor approvals (migration 0083).
export {
  PosPermissionError,
  CASHIER_PERMISSION_CATALOGUE,
  PERMISSION_AREAS,
  normalizeProfileCode,
  permissionProfileCapabilities,
  listPermissionProfiles,
  getPermissionProfile,
  createPermissionProfile,
  updatePermissionProfile,
  clonePermissionProfile,
  validatePermissionProfile,
  setPermissionProfileStatus,
  activatePermissionProfile,
  deactivatePermissionProfile,
  deletePermissionProfile,
  assignPermissionProfile,
  getPermissionProfileAuditHistory,
  getEffectivePosPermissions,
  getCashierEffectivePermissionSummary,
  authorizePosAction,
  assertPosAction,
  validatePermissionLimits,
  requestSupervisorApproval,
  getPosApproval,
  listPosApprovals,
  approvePosException,
  rejectPosException,
  validateApproval,
  consumeApprovalAtomically,
  getCashierPermissionCatalogue,
} from "./permissions/index.js";

// Cashiers -- the POS profile over a workspace user, and where they may work (migration 0082).
export {
  PosCashierError,
  normalizeCashierCode,
  cashierCapabilities,
  listCashiers,
  getCashier,
  getCashierOptions,
  createCashier,
  updateCashier,
  setCashierOutlets,
  assignOutletAccess,
  removeOutletAccess,
  setDefaultOutlet,
  validateCashierSetup,
  validateCashierForDeactivation,
  setCashierStatus,
  deleteCashier,
  validateCashierOperationAccess,
  assertCashierCanOpenSession,
  openPosForCashier,
  getCurrentCashierSession,
  getCashierSessions,
  getCashierTransactions,
  getCashierHistory,
  listOutletCashiers,
} from "./cashiers/index.js";
// Organization POS policy -- the configuration checkout, returns and tender already READ (POS-CAP-001 / -003). An outlet's own payment
// methods and providers are part of the outlet (configureOutletPaymentMethods).
export {
  getPosSettings,
  updatePosSettings,
  POS_SETTINGS_DEFAULTS,
} from "./store-terminal-and-cashier-control/settings-and-payment-config.js";

// POS-CAP-002 -- assortment, pricing, customer and cart (F272-F281).
// Product Search (migration 0084): name, SKU, barcode and category search over the shared Item Master, outlet-aware price and stock.
export {
  searchPosProducts,
  lookupPosProductByBarcode,
  getPosProductDetails,
  listPosProductCategories,
  getPosQuickProducts,
  getPosOutletProductSettings,
  updatePosOutletProductSettings,
  setPosQuickProducts,
  validatePosProductSelection,
  resolvePosProductContext,
  assertPosCartProductsSellable,
  POS_PRODUCT_MESSAGES,
} from "./product-search/index.js";
// Barcode Scanning (migration 0085): a scan is an input to Product Search and the cart — scan actions, serials, batches, scanner settings.
export {
  processPosScan,
  validateScannedSerial,
  allocateScannedBatch,
  getScannerConfiguration,
  updateScannerConfiguration,
  recordScanDiagnostic,
  listScanDiagnostics,
  findPosSaleLineByBarcode,
  POS_SCAN_MESSAGES,
} from "./barcode-scanning/index.js";
export { searchPointOfSaleCustomers, quickCreatePosCustomer } from "./assortment-pricing-customer-and-cart/customers.js";
export { priceCartLines } from "./assortment-pricing-customer-and-cart/cart-pricing.js";
export {
  createPosCart,
  getPosCart,
  addPosCartLine,
  addProductToPosCart,
  updatePosCartLineQuantity,
  removePosCartLine,
  setPosCartLineTracking,
  applyPosCartLineDiscount,
  removePosCartLineDiscount,
  setPosCartDiscount,
  assertPosCartDiscountsAuthorized,
  setPosCartCustomer,
  holdPosCart,
  resumePosCart,
  listHeldPosCarts,
  cancelPosCart,
  // Cart (migration 0086): lifecycle, notes, price overrides, history, checkout readiness and the checkout lock.
  getActivePosCart,
  setPosCartNotes,
  overridePosCartLinePrice,
  validatePosCartForCheckout,
  beginPosCheckout,
  ensurePosCheckoutStarted,
  releasePosCheckout,
  getPosCartHistory,
  cartLifecycle,
  POS_CART_MESSAGES,
  // Walk-In Customer (migration 0087): customer mode, buyer details and receipt contact on the bill.
  getPosCustomerContext,
  setWalkInCustomer,
  selectPosCustomer,
  updateWalkInBuyerDetails,
  setReceiptDeliveryContact,
  buildPosBuyerSnapshot,
  POS_CUSTOMER_MESSAGES,
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
export { getPosSaleReceipt, recordPosReceiptPrintAttempt, listPosReceiptPrintEvents, sendPosDigitalReceipts, listPosReceiptDeliveries } from "./transaction-continuity-and-documents/receipts.js";
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

// Stable public POS API boundary. Implementation is owned by the nine
// POS-CAP-00x capability directories, plus shared/ for cross-cutting infrastructure
// (error factory, permission/store-access checks, the audit event writer,
// and the generic multi-resource list) that has no single capability
// owner -- mirroring services/api/src/modules/crm/index.js's own "implementation
// is owned by the capability directories" boundary.
export { getPointOfSaleDashboard } from "./pos-analytics/dashboard.js";
export { getWalkInSalesSummary } from "./pos-analytics/walk-in.js";
export { getPosSaleTaxes, getPosTaxSummary } from "./pos-analytics/taxes.js";
export { getPosDiscountSummary } from "./pos-analytics/discounts.js";
export { POS_CART_DISCOUNT_EXCLUSIONS, POS_CART_DISCOUNT_MESSAGES, POS_ITEM_DISCOUNT_MESSAGES } from "./assortment-pricing-customer-and-cart/cart-pricing.js";
export { POS_TAX_MESSAGES } from "./assortment-pricing-customer-and-cart/cart-pricing.js";

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
export {
  searchPointOfSaleCustomers,
  quickCreatePosCustomer,
  getPosCustomerPreview,
  listPosCustomerBillingAddresses,
  getPosCustomerPurchaseHistory,
} from "./assortment-pricing-customer-and-cart/customers.js";
export { priceCartLines } from "./assortment-pricing-customer-and-cart/cart-pricing.js";
export {
  createPosCart,
  getPosCart,
  addPosCartLine,
  addProductToPosCart,
  getPosOpenItemOptions,
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
  setPosCartSupply,
  previewPosCartLineDiscount,
  previewPosCartDiscount,
  removePosCartDiscount,
  getPosCartDiscountEligibility,
  getPosCartLineDiscountEligibility,
  listPosCartDiscounts,
  getPosCartTaxes,
  setPosCartBillingAddress,
  setWalkInCustomer,
  selectPosCustomer,
  updateWalkInBuyerDetails,
  setReceiptDeliveryContact,
  buildPosBuyerSnapshot,
  POS_CUSTOMER_MESSAGES,
} from "./assortment-pricing-customer-and-cart/cart.js";
// Exported publicly (not just used internally by sale-completion.js/
// pos-returns.js) because it commits loyalty effects idempotently on
// the sale id.
export { commitPosLoyaltyForSale } from "./assortment-pricing-customer-and-cart/loyalty.js";
export { completePointOfSale, completePosCart } from "./assortment-pricing-customer-and-cart/sale-completion.js";

// POS-CAP-003 -- tender and payment execution (F282-F286).
export {
  initiatePosPayment,
  getPosPaymentStatus,
  voidPosPayment,
  requestPosPaymentOverride,
  approvePosPaymentOverride,
  rejectPosPaymentOverrideApproval,
  handlePosPaymentWebhook,
  resolvePaymentAdapter,
  PaymentAdapterError,
} from "./tender-and-payment-execution/payments.js";
export {
  POS_CASH_MESSAGES,
  suggestCashTenderAmounts,
  getPosCheckoutPaymentMethods,
  previewPosCashPayment,
  confirmPosCashPayment,
  finalizePosCashPayment,
  returnPosCashTender,
  flagPosCashTenderForReconciliation,
  resolvePosCashReconciliation,
  getPosCheckoutPayments,
  getPosPaymentDetail,
  listPosSessionCashPayments,
  getPosCashPaymentSummary,
} from "./tender-and-payment-execution/cash-payments.js";
export {
  POS_CARD_MESSAGES,
  listPosPaymentTerminals,
  savePosPaymentTerminal,
  startPosCardPayment,
  getPosCardAttempt,
  cancelPosCardAttempt,
  recordStandaloneCardPayment,
  finalizePosCardCheckout,
  refundPosCardPayment,
  getPosCardRefund,
  refundUnfinalizedCardPayment,
  getPosCardPaymentSummary,
  getPosCheckoutCardOptions,
  listPosCardConfigs,
  updatePosCardConfig,
} from "./tender-and-payment-execution/card-payments.js";
export {
  POS_UPI_MESSAGES,
  getPosCheckoutUpiOptions,
  startPosUpiPayment,
  recordStaticUpiPayment,
  listPosUpiConfigs,
  updatePosUpiConfig,
  listPosPaymentExceptions,
  resolvePosPaymentException,
  getPosDigitalPaymentSummary,
} from "./tender-and-payment-execution/upi-payments.js";
export {
  POS_SPLIT_MESSAGES,
  getPosSplitPaymentStatus,
  saveSplitPaymentPlan,
  initiateSplitComponent,
  finalizeSplitCheckout,
  cancelSplitCheckout,
  previewPosReturnRefundAllocation,
  getPosSplitPaymentSummary,
} from "./tender-and-payment-execution/split-payments.js";

// POS-CAP-004 -- transaction continuity and documents (F287-F290).
export { getPosSaleReceipt, sendPosDigitalReceipts, listPosReceiptDeliveries } from "./transaction-continuity-and-documents/receipts.js";
export {
  POS_RECEIPT_MESSAGES,
  resolvePosDocument,
  renderReceiptHtml,
  code128Svg,
  previewPosReceipt,
  createPosReceiptPrintJob,
  reportPosReceiptPrintJob,
  retryPosReceiptPrintJob,
  getPosReceiptPrintJob,
  listPosReceiptPrintHistory,
  resolvePosReceiptFromCode,
  listPosReceiptPrinters,
  savePosReceiptPrinter,
  testPosReceiptPrinter,
  updatePosReceiptBranding,
  getPosReceiptBranding,
  POS_RECEIPT_REPRINT_REASONS,
  issuePosDocument,
  getPosReceiptReprintEligibility,
  getPosReprintSummary,
} from "./transaction-continuity-and-documents/receipt-printing.js";
// GST Invoice (0098): POS as a source of the shared invoicing.
export {
  POS_INVOICE_MESSAGES,
  invoiceCheckoutIssues,
  issuePosSaleInvoice,
  issuePosReturnCreditNote,
  getPosInvoice,
  getPosSaleInvoice,
  listPosInvoices,
  getPosInvoiceEInvoiceStatus,
  reconcilePosInvoice,
  getPosGstSummary,
} from "./transaction-continuity-and-documents/gst-invoices.js";
export { previewPosCartInvoice } from "./assortment-pricing-customer-and-cart/cart.js";
// Transactions workspace — search/drill-down over completed sales. Same
// capability directory as receipts: a completed sale IS the
// transaction this reads, just a richer, filterable/paginated view of it.
export { listPosTransactions, getPosTransactionDetail } from "./transaction-continuity-and-documents/transactions.js";

// POS-CAP-005 -- returns, refunds and exchanges (F291-F293).
// POS Returns (0099): draft → approval / inspection → posted; refunds with their own status.
export {
  POS_RETURN_MESSAGES,
  findPosSaleForReturn,
  getPosSaleReturnEligibility,
  createPosReturn,
  updatePosReturn,
  requestPosReturnApproval,
  approvePosReturn,
  rejectPosReturn,
  cancelPosReturn,
  recordPosReturnInspection,
  postPosReturn,
  confirmPosReturnRefund,
  retryPosReturnRefunds,
  releasePosReturnStock,
  getPosReturn,
  listPosReturns,
  getPosReturnSummary,
  initiatePosReturnRefund,
} from "./returns-refunds-and-exchanges/pos-returns.js";
// Refunds (0100): one shared refund service — obligation, components per tender, attempts, reconciliation.
export {
  POS_REFUND_MESSAGES,
  getPosRefundEligibility,
  previewPosRefund,
  createPosRefund,
  approvePosRefund,
  executePosRefund,
  confirmPosRefundCash,
  recordPosManualRefund,
  refreshPosRefund,
  retryPosRefundComponent,
  cancelPosRefund,
  processPosRefundProviderEvent,
  getPosRefund,
  listPosRefunds,
  listPosRefundExceptions,
  resolvePosRefundException,
  getPosRefundSummary,
  renderPosRefundAcknowledgement,
} from "./tender-and-payment-execution/refunds.js";

// POS-CAP-007 -- cash, shift, day-end and reconciliation (F299-F305).
export { getPosShift } from "./cash-shift-day-end-and-reconciliation/shift-operations.js";
export {
  POS_SHIFT_CLOSE_MESSAGES, CASH_DESTINATIONS, CLOSING_VARIANCE_REASONS, getShiftClosingContext, getShiftBlockingTransactions, getShiftPaymentSummary, beginShiftClosing,
  cancelShiftClosing, submitBlindCashCount, getShiftCashReconciliation, requestShiftClosingApproval, assignShiftClosingException, prepareCashHandover, finalizeShiftClosing, closeShift,
  recoverShiftClosing, getShiftClosingReport, recordShiftClosingPrint, getShiftClosingHistory, listCashCustodyTransfers, acceptCashCustodyTransfer,
  listShiftClosingExceptions, resolveShiftClosingException, getCashSessionReconciliation, submitCashSessionCount, requestCashSessionVarianceApproval,
} from "./cash-shift-day-end-and-reconciliation/shift-closing.js";
// POS Cash Difference (0106): shortages and overages as cases — policy, investigation, resolution, Finance treatment, reporting.
export {
  CASH_DIFFERENCE_MESSAGES, CASH_DIFFERENCE_REASONS, FINANCE_TREATMENTS, RESOLUTION_TYPES, cashLedgerVersion, closingVariancePolicy, evaluateCashVariance, getCashDifference,
  getCashDifferenceSummary, investigateCashDifference, listCashDifferences, recordCashDifferenceFinanceTreatment, resolveCashDifference,
} from "./cash-shift-day-end-and-reconciliation/cash-differences.js";
// POS Shift Opening (0103): the operating session and its linked cash session.
export {
  POS_SHIFT_MESSAGES, assertShiftCashSession, assertShiftOperational, getCurrentPosShift, getShiftOpeningContext, getShiftOpeningSummary, getTerminalHandover, listPosShiftOpenings,
  openPosCashSession,
  openShift, previewShiftOpening, recordShiftOpeningAttempt, shiftView as getPosShiftSession, suspendPosShift, resumePosShift, flagPosShiftForRecovery, resolvePosShiftRecovery,
} from "./cash-shift-day-end-and-reconciliation/shift-opening.js";
export { recordPosCashMovement, listPosCashMovements } from "./cash-shift-day-end-and-reconciliation/cash-movements.js";
// POS Day-End / Z Report (0107): business days, the X report, readiness and exceptions, approval, finalization, history, prints, adjustments.
export {
  POS_DAY_END_MESSAGES, approveDayEndExceptions, beginDayEndClosing, buildXReport, finalizeZReport, getDayEndContext, getDayEndReadiness, getZReport, getZReportForDay,
  listZReportAdjustments, listZReports, recordZReportAdjustment, recordZReportPrint, recoverDayEndFinalization, requestDayEndApproval, resolveOutletBusinessDay,
  setOutletBusinessDayCutoff, syncZReportAdjustments,
} from "./cash-shift-day-end-and-reconciliation/day-end-reports.js";
// Payment Reconciliation (0108): merchant accounts, settlement imports, matching (auto and controlled manual), bank receipts, settlement posting,
// the exception queue, runs, the dashboard and reports.
export {
  RECONCILIATION_MESSAGES, RECONCILIATION_ADAPTERS, STANDARD_SETTLEMENT_COLUMNS, applyManualMatch, approveManualMatch, commitSettlementImport, getPaymentReconciliationStatus,
  getReconciliationException, getReconciliationOverview, getReconciliationReport, getReconciliationRun, getSettlementBatch, listMerchantAccounts, listReconciliationBankAccounts, listReconciliationExceptions,
  listSettlementBatches, matchBankReceipts, postSettlementToFinance, previewSettlementImport, reconciliationSummaryForSales, recoverReconciliationRuns, resolveReconciliationException,
  reverseMatch, saveMerchantAccount, startReconciliationRun, suggestReconciliationMatches, updateReconciliationException,
} from "./cash-shift-day-end-and-reconciliation/payment-reconciliation.js";
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

// POS Stock Reduction (0101): checkout reservations in Inventory, consumption at sale completion, recovery, status, movements and reporting.
export {
  POS_STOCK_MESSAGES, getPosCheckoutStockStatus, getPosSaleStockMovements, getPosStockSummary, renewPosCheckoutStock,
  resolvePosFulfillmentWarehouse, sweepExpiredPosCheckoutReservations, sweepPosCheckoutReservations,
} from "./inventory-and-offline-continuity/stock-reduction.js";

// POS Real-Time Inventory (0102): live availability at an outlet, a bill's stock, the change feed behind the live stream, sync health.
export {
  POS_INVENTORY_MESSAGES, authorizedPosInventoryScope, getPosBulkItemAvailability, getPosCartAvailability, getPosInventorySyncHealth, getPosItemStock,
  listPosInventoryChanges, posStockStatus, prunePosInventoryEvents,
} from "./inventory-and-offline-continuity/realtime-inventory.js";

// POS Opening Cash Float (0104): the cash session as a custody record — drawers, the confirmed opening count, corrections, expected cash, history.
export {
  assignTerminalCashDrawer, getCashDrawerHandover, getCashSessionExpectedBalance, getPosCashOpeningCount, getPosCashSession, listPosCashDrawers, listPosCashOpeningHistory,
  recordPosOpeningCorrection, savePosCashDrawer,
} from "./cash-shift-day-end-and-reconciliation/cash-sessions.js";

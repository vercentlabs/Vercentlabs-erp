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
  applyPosCartCoupon,
  removePosCartCoupon,
  holdPosCart,
  resumePosCart,
  listHeldPosCarts,
  cancelPosCart,
  redeemPosCartLoyaltyPoints,
  removePosCartLoyaltyRedemption,
} from "./assortment-pricing-customer-and-cart/cart.js";
export { listPosPromotions, createPosPromotion, updatePosPromotion, setPosPromotionActive } from "./assortment-pricing-customer-and-cart/promotions.js";
export { listPosCoupons, createPosCoupon, updatePosCoupon, setPosCouponActive } from "./assortment-pricing-customer-and-cart/coupons.js";
export {
  getPosLoyaltyProgram,
  upsertPosLoyaltyProgram,
  setPosLoyaltyProgramActive,
  getPosCustomerLoyaltyBalance,
  listPosCustomerLoyaltyLedger,
  adjustPosCustomerLoyaltyBalance,
  // Exported publicly (not just used internally by sale-completion.js/
  // return-lifecycle.js) because it is also the intended entry point for
  // a future offline-sync replay path to commit loyalty effects for a
  // sale synced outside the normal completePosCart/completePointOfSale
  // flow -- see its own idempotent-on-sale-id design.
  commitPosLoyaltyForSale,
} from "./assortment-pricing-customer-and-cart/loyalty.js";
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
export { getPosSaleReceipt } from "./transaction-continuity-and-documents/receipts.js";

// POS-CAP-005 -- returns, refunds and exchanges (F291-F293).
export { findPosSaleForReturn } from "./returns-refunds-and-exchanges/returns.js";
export { createPointOfSaleReturn, approvePointOfSaleReturn, completePointOfSaleReturn } from "./returns-refunds-and-exchanges/return-lifecycle.js";
export { completePosExchange } from "./returns-refunds-and-exchanges/exchange.js";

// POS-CAP-007 -- cash, shift, day-end and reconciliation (F299-F305).
export { openShift, closeShift } from "./cash-shift-day-end-and-reconciliation/shift-operations.js";
export { recordPosCashMovement, listPosCashMovements } from "./cash-shift-day-end-and-reconciliation/cash-movements.js";
export {
  generatePosDayEndReport,
  reviewPosDayEndReport,
  finalizePosDayEndReport,
  recordPosDayEndVariance,
  listPosDayEndReports,
  getPosDayEndReport,
} from "./cash-shift-day-end-and-reconciliation/day-end-reports.js";

// POS-CAP-006 -- inventory and offline continuity (F294-F298).
export {
  OFFLINE_SNAPSHOT_ITEM_LIMIT,
  OFFLINE_UNSUPPORTED_OPERATIONS,
  getPosOfflineSnapshot,
  listPosOfflineSyncConflicts,
  syncOfflinePosSale,
  resolvePosOfflineSyncConflict,
} from "./inventory-and-offline-continuity/offline-sync.js";

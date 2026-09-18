export type PointOfSaleContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getPointOfSaleDashboard(client: any, context: PointOfSaleContext): Promise<any>;
export declare function listPointOfSaleResource(client: any, context: PointOfSaleContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function listPosStoreSetupOptions(client: any, context: PointOfSaleContext): Promise<{ branches: any[]; warehouses: any[]; priceLists: any[] }>;
export declare function createStore(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function updatePosStore(client: any, context: PointOfSaleContext, id: string, input: Record<string, any>): Promise<any>;
export declare function setPosStoreActive(client: any, context: PointOfSaleContext, id: string, active: boolean): Promise<any>;
export declare function createTerminal(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function updatePosTerminal(client: any, context: PointOfSaleContext, id: string, input: Record<string, any>): Promise<any>;
export declare function setPosTerminalStatus(client: any, context: PointOfSaleContext, id: string, status: "active" | "inactive" | "maintenance"): Promise<any>;
export declare function openShift(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;

// F270/F271 cashier eligibility administration
export type PosEligibleCashier = { id: string; fullName: string; email: string; roleSlugs: string[]; assignedStoreIds: string[] };
export declare function listPosEligibleCashiers(client: any, context: PointOfSaleContext): Promise<PosEligibleCashier[]>;
export type PosStoreAccessGrant = { id: string; userId: string; storeId: string; fullName: string; email: string; createdAt: string };
export declare function listPosStoreAccess(client: any, context: PointOfSaleContext, storeId?: string | null): Promise<PosStoreAccessGrant[]>;
export declare function grantPosStoreAccess(client: any, context: PointOfSaleContext, input: { userId: string; storeId: string }): Promise<any>;
export declare function revokePosStoreAccess(client: any, context: PointOfSaleContext, input: { userId: string; storeId: string }): Promise<{ revoked: true }>;
export declare function completePointOfSale(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function findPosSaleForReturn(client: any, context: PointOfSaleContext, input: { receiptNumber: string }): Promise<{ sale: Record<string, any>; lines: Record<string, any>[] }>;
export declare function createPointOfSaleReturn(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function approvePointOfSaleReturn(client: any, context: PointOfSaleContext, returnId: string, input?: Record<string, any>): Promise<any>;
export declare function completePointOfSaleReturn(client: any, context: PointOfSaleContext, returnId: string, input?: Record<string, any>): Promise<any>;

// F293 exchanges
export declare function completePosExchange(client: any, context: PointOfSaleContext, input: {
  returnId: string;
  cartId: string;
  idempotencyKey: string;
  payments: Array<{ method: string; amount: number }>;
  expectedVersion?: number;
  expectedGrandTotal?: string;
}): Promise<{ return: any; sale: any }>;
export declare function closeShift(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;

// F300 cash movements
export declare function recordPosCashMovement(client: any, context: PointOfSaleContext, shiftId: string, input: { movementType: "paid_in" | "paid_out"; amount: number; reason: string; idempotencyKey: string }): Promise<any>;
export declare function listPosCashMovements(client: any, context: PointOfSaleContext, shiftId: string): Promise<any[]>;

// F303 Day-end / Z report. Field names are snake_case, matching the raw
// tenant.pos_day_end_reports row shape (same convention as PosCart) —
// F304's reconciliation workstream reads this shape directly.
export type PosDayEndTender = { method: string; amount: string; count: number };
export type PosDayEndLineage = { shiftIds: string[]; saleIds: string[]; returnIds: string[]; cashMovementIds: string[] };
export type PosDayEndReport = {
  id: string;
  organization_id: string;
  company_id: string;
  store_id: string;
  terminal_id: string | null;
  scope_type: "shift" | "business_day";
  shift_id: string | null;
  business_date: string;
  status: "draft" | "reviewed" | "closed" | "void";
  report_number: string;
  sale_count: number;
  gross_sales_total: string;
  discount_total: string;
  tax_total: string;
  net_sales_total: string;
  rounding_total: string;
  grand_sales_total: string;
  return_count: number;
  return_total: string;
  tender_totals: PosDayEndTender[];
  opening_cash_total: string;
  paid_in_total: string;
  paid_out_total: string;
  expected_cash_total: string;
  counted_cash_total: string | null;
  cash_variance_total: string;
  lineage: PosDayEndLineage;
  reconciliation_status: "pending" | "matched" | "exception";
  reconciliation_references: Array<{ type: string; id: string; note?: string }>;
  outstanding_exceptions: Array<Record<string, any>>;
  generated_by: string;
  generated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  finalized_by: string | null;
  finalized_at: string | null;
  replayed?: boolean;
  corrections?: PosDayEndReportCorrection[];
  [key: string]: any;
};
export type PosDayEndReportCorrection = {
  id: string;
  original_report_id: string;
  correction_number: string;
  variance_type: "cash_variance" | "total_adjustment" | "reclassification" | "other";
  reason: string;
  adjustment: Array<Record<string, any>>;
  created_by: string;
  created_at: string;
  [key: string]: any;
};
export declare function generatePosDayEndReport(client: any, context: PointOfSaleContext, input: { storeId: string; scopeType: "shift" | "business_day"; shiftId?: string; terminalId?: string; businessDate?: string; idempotencyKey?: string }): Promise<PosDayEndReport>;
export declare function reviewPosDayEndReport(client: any, context: PointOfSaleContext, reportId: string, input?: { reviewNotes?: string | null }): Promise<PosDayEndReport>;
export declare function finalizePosDayEndReport(client: any, context: PointOfSaleContext, reportId: string, input?: { closeNotes?: string | null }): Promise<PosDayEndReport>;
export declare function recordPosDayEndVariance(client: any, context: PointOfSaleContext, reportId: string, input: { varianceType: "cash_variance" | "total_adjustment" | "reclassification" | "other"; reason: string; adjustment?: Array<Record<string, any>> }): Promise<PosDayEndReportCorrection>;
export declare function listPosDayEndReports(client: any, context: PointOfSaleContext, options?: { storeId?: string; terminalId?: string; status?: string; scopeType?: string; businessDateFrom?: string; businessDateTo?: string; limit?: number; offset?: number }): Promise<PosDayEndReport[]>;
export declare function getPosDayEndReport(client: any, context: PointOfSaleContext, reportId: string): Promise<PosDayEndReport>;

// F290 — invoice generation. The returned shape is Accounting's own
// getCustomerInvoice() composite { invoice, lines, schedules, ... }.
export declare function generatePosInvoice(client: any, context: PointOfSaleContext, saleId: string, input?: { notes?: string | null; idempotencyKey?: string }): Promise<{ invoice: Record<string, any>; lines: Record<string, any>[]; [key: string]: any }>;
export declare function getPosInvoiceForSale(client: any, context: PointOfSaleContext, saleId: string): Promise<{ invoice: Record<string, any>; lines: Record<string, any>[]; [key: string]: any }>;
export declare function listPosInvoices(client: any, context: PointOfSaleContext, options?: { storeId?: string; customerId?: string; limit?: number; offset?: number }): Promise<Record<string, any>[]>;

// F304 — payment reconciliation.
export type PosSettlementBatch = { id: string; organization_id: string; company_id: string; store_id: string | null; payment_method: string; provider_key: string; batch_reference: string; settlement_date: string; total_amount: string; total_fee_amount: string; entry_count: number; status: "imported" | "matched" | "closed"; [key: string]: any };
export type PosSettlementEntry = { id: string; batch_id: string; provider_reference: string; amount: string; fee_amount: string; settled_at: string; matched_payment_id: string | null; match_status: "unmatched" | "matched" | "duplicate"; [key: string]: any };
export type PosReconciliation = { id: string; organization_id: string; company_id: string; store_id: string | null; day_end_report_id: string | null; shift_id: string | null; payment_method: string; reconciliation_number: string | null; expected_amount: string; counted_amount: string; settled_amount: string; variance_amount: string; fee_total: string; missing_count: number; duplicate_count: number; status: "draft" | "matched" | "variance" | "resolved"; matched_by: string | null; matched_at: string | null; resolved_by: string | null; resolved_at: string | null; resolution_notes: string | null; approved_by: string | null; approved_at: string | null; [key: string]: any };
export declare function importPosSettlementBatch(client: any, context: PointOfSaleContext, input: { storeId?: string | null; paymentMethod: "card" | "upi" | "bank_transfer" | "wallet" | "store_credit"; providerKey: string; batchReference: string; settlementDate: string; entries: Array<{ providerReference: string; amount: number; feeAmount?: number; settledAt?: string }> }): Promise<{ batch: PosSettlementBatch; entries: PosSettlementEntry[]; replayed: boolean }>;
export declare function generatePosReconciliation(client: any, context: PointOfSaleContext, reportId: string, input?: { idempotencyKey?: string }): Promise<{ reportId: string; reconciliations: PosReconciliation[]; replayed: boolean }>;
export declare function resolvePosReconciliation(client: any, context: PointOfSaleContext, reconciliationId: string, input: { resolutionNotes: string }): Promise<PosReconciliation>;
export declare function recordPosReconciliationCorrection(client: any, context: PointOfSaleContext, reconciliationId: string, input: { reason: string; adjustment?: Array<Record<string, any>> }): Promise<Record<string, any>>;
export declare function listPosReconciliations(client: any, context: PointOfSaleContext, options?: { storeId?: string; dayEndReportId?: string; status?: string; limit?: number; offset?: number }): Promise<PosReconciliation[]>;
export declare function getPosReconciliation(client: any, context: PointOfSaleContext, reconciliationId: string): Promise<PosReconciliation & { corrections: Record<string, any>[] }>;

// F305 — POS accounting posting.
export type PosAccountingPostingOutcome = { posted: boolean; replayed?: boolean; failed?: boolean; journalEntryId?: string; message?: string };
export declare function postPosSaleToAccounting(client: any, context: PointOfSaleContext, saleId: string): Promise<PosAccountingPostingOutcome>;
export declare function postPosReturnToAccounting(client: any, context: PointOfSaleContext, returnId: string): Promise<PosAccountingPostingOutcome>;
export declare function postPosDayEndReportToAccounting(client: any, context: PointOfSaleContext, reportId: string): Promise<{ reportId: string; posted: Array<{ type: string; id: string; journalEntryId: string }>; alreadyPosted: Array<{ type: string; id: string }>; failed: Array<{ type: string; id: string; message: string }> }>;
export declare function listPosAccountingPostingQueue(client: any, context: PointOfSaleContext, options?: { status?: string; storeId?: string; limit?: number }): Promise<Record<string, any>[]>;

// F307 — POS sales analytics.
export declare function getPosSalesAnalytics(client: any, context: PointOfSaleContext, filters: { dateFrom: string; dateTo: string; storeId?: string; terminalId?: string; cashierId?: string }): Promise<Record<string, any>>;

// F297/F298 — offline POS workspace + offline-to-online sync
export type PosOfflineUnsupportedOperation = { code: string; label: string; reason: string };
export declare const OFFLINE_SNAPSHOT_ITEM_LIMIT: number;
export declare const OFFLINE_UNSUPPORTED_OPERATIONS: readonly PosOfflineUnsupportedOperation[];
export type PosOfflineSnapshot = {
  version: string;
  generatedAt: string;
  store: { id: string; code: string; name: string; warehouseId: string; currencyCode: string; priceListId: string | null };
  policy: { allowNegativeStock: boolean; maxLineDiscountPercent: number };
  items: Array<{ itemId: string; code: string; name: string; barcode: string | null; taxCategoryId: string | null; unitPrice: number; minimumQuantity: number; lastKnownQuantity: number }>;
  itemLimit: number;
  itemLimitReached: boolean;
  taxRatesByCategory: Array<{ taxCategoryId: string; rate: number }>;
  cashierPermissions: string[];
  unsupportedOperations: readonly PosOfflineUnsupportedOperation[];
  encryptionSeed: string;
};
export declare function getPosOfflineSnapshot(client: any, context: PointOfSaleContext, input: { storeId: string }): Promise<PosOfflineSnapshot>;

export type PosOfflineSyncLine = {
  itemId: string;
  variantId?: string | null;
  quantity: number;
  capturedUnitPrice: number;
  discountAmount?: number | null;
  discountReason?: string | null;
  description?: string | null;
  warehouseLocationId?: string | null;
  batchId?: string | null;
  serialId?: string | null;
};
export type PosOfflineSyncInput = {
  localTransactionId: string;
  storeId: string;
  terminalId?: string | null;
  shiftId: string;
  lines: PosOfflineSyncLine[];
  payments: Array<{ method: string; amount: number }>;
  customerName?: string | null;
  roundingAdjustment?: number;
  capturedAt?: string | null;
};
export type PosOfflineSyncResult =
  | { outcome: "accepted"; localTransactionId: string; sale: any; replayed: boolean }
  | { outcome: "conflict"; localTransactionId: string; conflictId: string; conflictType: string; detail: string | null; replayed: boolean }
  | { outcome: "voided"; localTransactionId: string; conflictId: string; detail: string | null; replayed: boolean };
export declare function syncOfflinePosSale(client: any, context: PointOfSaleContext, input: PosOfflineSyncInput): Promise<PosOfflineSyncResult>;

export type PosOfflineSyncConflict = {
  id: string;
  local_transaction_id: string;
  conflict_type: string;
  status: "pending" | "resolved_retried" | "resolved_voided";
  captured_payload: Record<string, any>;
  server_context_snapshot: Record<string, any>;
  [key: string]: any;
};
export declare function listPosOfflineSyncConflicts(client: any, context: PointOfSaleContext, options?: { status?: string; limit?: number; offset?: number }): Promise<PosOfflineSyncConflict[]>;
// A retry line never carries capturedUnitPrice: resolvePosOfflineSyncConflict's
// retry path always re-resolves the CURRENT price fresh server-side
// (currentOfflineCatalogUnitPrice), never trusts a client-supplied
// captured price for an operator-reviewed retry.
export type PosOfflineRetryLine = Omit<PosOfflineSyncLine, "capturedUnitPrice">;
export declare function resolvePosOfflineSyncConflict(
  client: any,
  context: PointOfSaleContext,
  conflictId: string,
  input: { action: "retry" | "void"; reason?: string; lines?: PosOfflineRetryLine[]; payments?: Array<{ method: string; amount: number }>; shiftId?: string },
): Promise<PosOfflineSyncConflict>;

export type PointOfSaleProductMatch = {
  itemId: string;
  variantId: string | null;
  name: string;
  code: string;
  barcode: string | null;
  salesPrice: string;
  trackingType: "none" | "batch" | "serial";
  availableQuantity: number;
};
export declare function searchPointOfSalePosProducts(client: any, context: PointOfSaleContext, storeId: string, input?: Record<string, any>): Promise<PointOfSaleProductMatch[]>;
export declare function lookupPointOfSaleBarcode(client: any, context: PointOfSaleContext, storeId: string, barcode: string): Promise<PointOfSaleProductMatch>;

// F276
export type PointOfSaleCustomerMatch = { id: string; code: string; displayName: string; phone: string | null; email: string | null };
export declare function searchPointOfSaleCustomers(client: any, context: PointOfSaleContext, input?: { query?: string; limit?: number; offset?: number }): Promise<PointOfSaleCustomerMatch[]>;

// F277 Cart. Field names are snake_case throughout -- getPosCart/reprice
// return the raw tenant.pos_carts/pos_cart_lines row shape directly
// (the same convention completePointOfSale/createPointOfSaleReturn
// already use for pos_sales/pos_returns), NOT a camelCase DTO. The
// [key: string]: any index signature exists only to tolerate additional
// raw columns, not as license to invent a parallel camelCase shape.
export type PosCartLine = {
  id: string;
  line_number: number;
  item_id: string;
  variant_id: string | null;
  description: string | null;
  quantity: string;
  list_price: string;
  unit_price: string;
  price_override: boolean;
  gross_amount: string;
  manual_discount_amount: string;
  manual_discount_reason: string | null;
  promotion_discount_amount: string;
  coupon_discount_amount: string;
  loyalty_redeem_amount: string;
  taxable_amount: string;
  tax_amount: string;
  line_total: string;
  tax_components: Array<{ type: string; label: string; rate: string; taxableAmount: string; taxAmount: string }>;
  warehouse_id: string | null;
  warehouse_location_id: string | null;
  batch_id: string | null;
  serial_id: string | null;
  // F295: joined in from tenant.items for display, not a real column on
  // pos_cart_lines -- see loadLines()'s doc comment in cart.js.
  tracking_type?: "none" | "batch" | "serial";
  [key: string]: any;
};
export type PosCart = {
  id: string;
  status: "draft" | "priced" | "held" | "completed" | "cancelled" | "expired";
  version: number;
  store_id: string;
  terminal_id: string;
  shift_id: string;
  customer_id: string | null;
  currency_code: string;
  subtotal: string;
  manual_discount_total: string;
  promotion_discount_total: string;
  coupon_discount_total: string;
  discount_total: string;
  tax_total: string;
  rounding_adjustment: string;
  grand_total: string;
  coupon_code: string | null;
  cart_discount_type: "percent" | "amount" | null;
  cart_discount_value: string | null;
  cart_discount_reason: string | null;
  loyalty_redeem_points: string | null;
  lines: PosCartLine[];
  promotionExplanations?: Array<{ code: string; applied: boolean; amountSaved?: string; reason: string }>;
  coupon?: { id: string; code: string; amount: string } | null;
  loyalty?: {
    programId: string | null;
    pointsToEarn: string;
    redeemPointsRequested: string;
    redeemPointsApplied: string;
    redeemAmount: string;
    balanceBeforeSale: string;
    balanceAfterPreview: string;
  };
  [key: string]: any;
};
export declare function createPosCart(client: any, context: PointOfSaleContext, input: { storeId: string; terminalId: string; shiftId: string; customerId?: string | null }): Promise<PosCart>;
export declare function getPosCart(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCart>;
export declare function addPosCartLine(client: any, context: PointOfSaleContext, cartId: string, input: Record<string, any>): Promise<PosCart>;
export declare function updatePosCartLineQuantity(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { quantity: number; expectedVersion?: number }): Promise<PosCart>;
export declare function removePosCartLine(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function setPosCartLineTracking(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { batchId?: string | null; serialId?: string | null; expectedVersion?: number }): Promise<PosCart>;
// F279: `approvedBy` is deliberately NOT part of this input -- a caller
// can never assert who approved a discount. Above the configured
// threshold, applying a discount creates a real pending request in
// public.approval_requests (see assertPosCartDiscountsApproved /
// approvePosCartDiscountApproval in features/cart.js); only a decision
// made through decideApproval() by a genuinely separate, permission-
// holding approver can satisfy it, checked again at completePosCart().
export declare function applyPosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { type: "percent" | "amount"; value: number; reason: string; expectedVersion?: number }): Promise<PosCart>;
export declare function removePosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function setPosCartDiscount(client: any, context: PointOfSaleContext, cartId: string, input: { type?: "percent" | "amount" | null; value?: number; reason?: string; expectedVersion?: number }): Promise<PosCart>;
export declare function assertPosCartDiscountsApproved(client: any, context: PointOfSaleContext, cart: PosCart, policy: Record<string, any>): Promise<void>;
export declare function approvePosCartDiscountApproval(client: any, context: Record<string, any>, payload: { discountApprovalId: string }): Promise<{ discountApprovalId: string; cartId: string; status: "approved" }>;
export declare function rejectPosCartDiscountApproval(client: any, context: Record<string, any>, payload: { discountApprovalId: string }): Promise<{ discountApprovalId: string; cartId: string; status: "rejected" }>;
export declare function setPosCartCustomer(client: any, context: PointOfSaleContext, cartId: string, input: { customerId: string | null; expectedVersion?: number }): Promise<PosCart>;
export declare function applyPosCartCoupon(client: any, context: PointOfSaleContext, cartId: string, input: { code: string; expectedVersion?: number }): Promise<PosCart>;
export declare function removePosCartCoupon(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function holdPosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function resumePosCart(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCart>;
export type PosHeldCart = {
  id: string;
  store_id: string;
  terminal_id: string;
  customer_id: string | null;
  customer_name: string | null;
  grand_total: string;
  held_at: string;
  version: number;
  cashier_user_id: string;
  store_name: string;
  terminal_name: string;
  line_count: number;
};
export declare function listHeldPosCarts(client: any, context: PointOfSaleContext, options?: { search?: string }): Promise<PosHeldCart[]>;

// F289 receipts
export declare function getPosSaleReceipt(client: any, context: PointOfSaleContext, saleId: string): Promise<{
  sale: Record<string, any>;
  lines: Record<string, any>[];
  payments: Record<string, any>[];
  returns: Record<string, any>[];
  promotionEvidence: Record<string, any>[];
}>;
export declare function cancelPosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { reason?: string }): Promise<PosCart>;
export declare function redeemPosCartLoyaltyPoints(client: any, context: PointOfSaleContext, cartId: string, input: { points: number | string; expectedVersion?: number }): Promise<PosCart>;
export declare function removePosCartLoyaltyRedemption(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function completePosCart(
  client: any,
  context: PointOfSaleContext,
  cartId: string,
  input: {
    idempotencyKey: string;
    // A 'cash' leg carries a client-asserted amount (unchanged, physical
    // exchange). Any other method carries the id of an ALREADY-CAPTURED
    // payment (see initiatePosPayment) -- never a client-asserted amount.
    payments: Array<{ method: "cash"; amount: number } | { method: "card" | "upi" | "wallet" | "bank_transfer"; paymentId: string }>;
    expectedVersion?: number;
    expectedGrandTotal?: string;
  },
): Promise<any>;

// F280 Promotions
export type PosPromotion = { id: string; code: string; name: string; status: "active" | "inactive"; [key: string]: any };
export declare function listPosPromotions(client: any, context: PointOfSaleContext, options?: { status?: string }): Promise<PosPromotion[]>;
export declare function createPosPromotion(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<PosPromotion>;
export declare function updatePosPromotion(client: any, context: PointOfSaleContext, id: string, input: Record<string, any>): Promise<PosPromotion>;
export declare function setPosPromotionActive(client: any, context: PointOfSaleContext, id: string, active: boolean): Promise<PosPromotion>;

// F281 Coupons
export type PosCoupon = { id: string; code: string; status: "active" | "inactive"; [key: string]: any };
export declare function listPosCoupons(client: any, context: PointOfSaleContext, options?: { status?: string }): Promise<PosCoupon[]>;
export declare function createPosCoupon(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<PosCoupon>;
export declare function updatePosCoupon(client: any, context: PointOfSaleContext, id: string, input: Record<string, any>): Promise<PosCoupon>;
export declare function setPosCouponActive(client: any, context: PointOfSaleContext, id: string, active: boolean): Promise<PosCoupon>;

// F306 Loyalty
export type PosLoyaltyProgram = {
  id: string;
  status: "active" | "inactive";
  name: string;
  earn_rate_points_per_currency: string;
  redemption_value_per_point: string;
  min_redemption_points: string;
  max_redemption_points_per_sale: string | null;
  max_redemption_percent_of_payable: string | null;
  min_eligible_sale_amount: string;
  points_expiry_days: number | null;
  [key: string]: any;
};
export type PosLoyaltyLedgerEntry = {
  id: string;
  entry_type: "earn" | "redeem" | "reverse_earn" | "reverse_redeem" | "expire" | "adjust";
  points: string;
  sale_id: string | null;
  sale_line_id: string | null;
  return_id: string | null;
  original_entry_id: string | null;
  created_at: string;
  [key: string]: any;
};
export declare function getPosLoyaltyProgram(client: any, context: PointOfSaleContext): Promise<PosLoyaltyProgram | null>;
export declare function upsertPosLoyaltyProgram(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<PosLoyaltyProgram>;
export declare function setPosLoyaltyProgramActive(client: any, context: PointOfSaleContext, active: boolean): Promise<PosLoyaltyProgram>;
export declare function getPosCustomerLoyaltyBalance(client: any, context: PointOfSaleContext, customerId: string): Promise<{ customerId: string; balance: string; updatedAt: string | null }>;
export declare function listPosCustomerLoyaltyLedger(client: any, context: PointOfSaleContext, customerId: string, options?: { limit?: number }): Promise<PosLoyaltyLedgerEntry[]>;
export declare function adjustPosCustomerLoyaltyBalance(client: any, context: PointOfSaleContext, customerId: string, points: number | string, reason: string): Promise<{ customerId: string; balance: string }>;

// F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286 (multiple
// payment methods): ONE payment-tender subsystem. Field names are
// snake_case, matching tenant.pos_payments directly (same convention as
// PosCart/PosCartLine above).
export type PosPaymentMethod = "cash" | "card" | "upi" | "wallet" | "bank_transfer" | "store_credit";
export type PosPaymentStatus = "initiated" | "pending" | "authorized" | "captured" | "failed" | "voided" | "refunded" | "partially_refunded";
export type PosPayment = {
  id: string;
  organization_id: string;
  company_id: string;
  cart_id: string | null;
  sale_id: string | null;
  store_id: string | null;
  shift_id: string;
  payment_method: PosPaymentMethod;
  amount: string;
  currency_code: string | null;
  provider_key: string;
  provider_reference: string | null;
  idempotency_key: string | null;
  status: PosPaymentStatus;
  refunded_amount: string;
  failure_reason: string | null;
  initiated_at: string;
  captured_at: string | null;
  voided_at: string | null;
  replayed?: boolean;
  [key: string]: any;
};
export declare function initiatePosPayment(
  client: any,
  context: PointOfSaleContext,
  input: { cartId: string; method: "card" | "upi" | "wallet" | "bank_transfer"; amount: number; idempotencyKey: string; outcome?: string },
): Promise<PosPayment>;
export declare function getPosPaymentStatus(client: any, context: PointOfSaleContext, paymentId: string): Promise<PosPayment>;
export declare function voidPosPayment(client: any, context: PointOfSaleContext, paymentId: string): Promise<PosPayment>;
export declare function refundPosPayment(
  client: any,
  context: PointOfSaleContext,
  input: { paymentId: string; amount: number; idempotencyKey: string; outcome?: string },
): Promise<PosPayment & { providerRefundReference?: string }>;
export declare function requestPosPaymentOverride(
  client: any,
  context: PointOfSaleContext,
  input: { paymentId: string; reason: string },
): Promise<{ paymentId: string; approvalRequest: { id: string; status: string; version: number } }>;
// Invoked only from the global cross-module approvals dispatch table
// (services/api/src/core/approvals.js), never directly from an HTTP route.
export declare function approvePosPaymentOverride(client: any, context: Record<string, any>, payload: { paymentId: string; reason?: string }): Promise<PosPayment>;
export declare function rejectPosPaymentOverrideApproval(client: any, context: Record<string, any>, payload: { paymentId: string }): Promise<PosPayment>;
export declare function handlePosPaymentWebhook(
  client: any,
  input: { providerKey: string; rawBody: string; signatureHeader: string | null },
): Promise<{ replayed: boolean; event: Record<string, any>; payment?: PosPayment | null }>;

export type PosPaymentAdapter = {
  key: string;
  initiate: (context: PointOfSaleContext, input: Record<string, any>) => Promise<{ providerReference: string; status: string; failureReason?: string; raw?: unknown }>;
  refund: (context: PointOfSaleContext, input: Record<string, any>) => Promise<{ providerRefundReference: string; status: string }>;
  verifyWebhookSignature: (rawBody: string, signatureHeader: string | null, env?: Record<string, string | undefined>) => boolean;
  parseWebhookEvent: (rawBody: string) => { eventId: string; eventType: string; organizationId: string; companyId: string; paymentId: string; providerReference: string | null; status: string; failureReason: string | null; raw: unknown };
};
export declare function resolvePaymentAdapter(providerKey: string): PosPaymentAdapter;
export declare class PaymentAdapterError extends Error {
  status: number;
  code: string;
}

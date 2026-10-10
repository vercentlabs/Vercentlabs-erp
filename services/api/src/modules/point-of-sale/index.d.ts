export type PointOfSaleContext = {
  organizationId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getPointOfSaleDashboard(client: any, context: PointOfSaleContext): Promise<any>;
export declare function listPointOfSaleResource(
  client: any,
  context: PointOfSaleContext,
  resource: string,
  options?: {
    limit?: number;
    offset?: number;
    shiftId?: string | null;
    storeId?: string | null;
    terminalId?: string | null;
    status?: string | null;
    cashierUserId?: string | null;
    movementType?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    withTotal?: boolean;
  },
): Promise<any[] | { rows: any[]; total: number }>;
export type PosSettingsValues = {
  require_shift_reconciliation: boolean;
  allow_negative_stock: boolean;
  allow_price_override: boolean;
  require_return_approval: boolean;
  prohibit_self_return_approval: boolean;
  default_currency_code: string;
  max_line_discount_percent: string;
  max_cart_discount_percent: string;
  discount_approval_threshold_percent: string;
  cart_expiry_minutes: number;
  held_cart_retention_hours: number;
  checkout_lock_minutes: number;
  walk_in_buyer_details_required_above: string | null;
};
export type PosSettings = { configured: boolean; updatedAt: string | null; settings: PosSettingsValues };
export declare const POS_SETTINGS_DEFAULTS: Readonly<PosSettingsValues>;
export declare function getPosSettings(client: any, context: PointOfSaleContext): Promise<PosSettings>;
export declare function updatePosSettings(client: any, context: PointOfSaleContext, input: Partial<Record<keyof PosSettingsValues, string | number | boolean | null>>): Promise<PosSettings>;
// Stores & Outlets (outlets/index.js).
export declare class PosOutletError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown);
}
export type PosOutletOption = { code: string; label: string };
export declare const OUTLET_TYPES: readonly PosOutletOption[];
export declare const OUTLET_PAYMENT_METHODS: readonly PosOutletOption[];
export declare function normalizeOutletCode(value: unknown): string;
export declare function outletCapabilities(context: PointOfSaleContext): Record<string, boolean>;
export declare function listOutlets(client: any, context: PointOfSaleContext, filters?: Record<string, string | undefined>): Promise<{ outlets: any[]; capabilities: Record<string, boolean> }>;
export declare function getOutlet(client: any, context: PointOfSaleContext, outletId: string): Promise<any>;
export declare function getOutletOptions(client: any, context: PointOfSaleContext): Promise<any>;
export declare function createOutlet(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function updateOutlet(client: any, context: PointOfSaleContext, outletId: string, input: Record<string, any>): Promise<any>;
export declare function validateOutletSetup(client: any, context: PointOfSaleContext, outletId: string): Promise<Array<{ code: string; field: string; message: string }>>;
export declare function validateOutletForDeactivation(client: any, context: PointOfSaleContext, outletId: string): Promise<Array<{ code: string; count: number; message: string }>>;
export declare function setOutletStatus(client: any, context: PointOfSaleContext, outletId: string, status: string, input?: { reason?: string }): Promise<any>;
export declare function deleteOutlet(client: any, context: PointOfSaleContext, outletId: string): Promise<{ deleted: true }>;
export declare function getOutletPaymentMethods(client: any, context: PointOfSaleContext, outletId: string): Promise<any[]>;
export declare function configureOutletPaymentMethods(client: any, context: PointOfSaleContext, outletId: string, methods: Array<{ method: string; enabled: boolean; accountId?: string | null; providerKey?: string | null }>): Promise<any[]>;
export declare function isOutletPaymentMethodEnabled(client: any, organizationId: string, outletId: string, method: string): Promise<boolean>;
export declare function getOutletAccess(client: any, context: PointOfSaleContext, outletId: string): Promise<any[]>;
export declare function getOutletInventorySummary(client: any, context: PointOfSaleContext, outletId: string): Promise<any>;
export declare function getOutletTerminals(client: any, context: PointOfSaleContext, outletId: string): Promise<any[]>;
export declare function getOutletSessions(client: any, context: PointOfSaleContext, outletId: string, filters?: Record<string, string>): Promise<any[]>;
export declare function getOutletTransactions(client: any, context: PointOfSaleContext, outletId: string, filters?: Record<string, string>): Promise<any[]>;
export declare function getOutletHistory(client: any, context: PointOfSaleContext, outletId: string): Promise<any[]>;
// POS Terminals (terminals/index.js).
export declare class PosTerminalError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown);
}
export declare function normalizeTerminalCode(value: unknown): string;
export declare function terminalCapabilities(context: PointOfSaleContext): Record<string, boolean>;
export declare function listTerminals(client: any, context: PointOfSaleContext, filters?: Record<string, string | undefined>): Promise<{ terminals: any[]; capabilities: Record<string, boolean> }>;
export declare function getTerminal(client: any, context: PointOfSaleContext, terminalId: string): Promise<any>;
export declare function getTerminalOptions(client: any, context: PointOfSaleContext): Promise<any>;
export declare function createTerminal(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function updateTerminal(client: any, context: PointOfSaleContext, terminalId: string, input: Record<string, any>): Promise<any>;
export declare function validateTerminalSetup(client: any, context: PointOfSaleContext, terminalId: string): Promise<Array<{ code: string; field: string; message: string }>>;
export declare function validateTerminalForDeactivation(client: any, context: PointOfSaleContext, terminalId: string): Promise<Array<{ code: string; count: number; message: string }>>;
export declare function setTerminalStatus(client: any, context: PointOfSaleContext, terminalId: string, status: string, input?: { reason?: string }): Promise<any>;
export declare function deleteTerminal(client: any, context: PointOfSaleContext, terminalId: string): Promise<{ deleted: true }>;
export declare function getEffectiveTerminalConfiguration(client: any, context: PointOfSaleContext, terminalId: string): Promise<any>;
export declare function isTerminalPaymentMethodEnabled(client: any, organizationId: string, terminalId: string, method: string): Promise<boolean>;
export declare function resolveTerminalStockSource(client: any, organizationId: string, terminalId: string, requestedLocationId?: string | null): Promise<{ warehouseId: string; locationId: string | null }>;
export declare function validateTerminalOperationAccess(client: any, context: PointOfSaleContext, terminalId: string): Promise<any>;
export declare function openPosForTerminal(client: any, context: PointOfSaleContext, terminalId: string): Promise<{ action: "resume" | "open_session"; terminal: any; sessionId: string | null; configuration: any }>;
export declare function assertTerminalCanOpenSession(client: any, context: PointOfSaleContext, terminalId: string, options?: { openingCash?: number | string }): Promise<any>;
export declare function getTerminalSessions(client: any, context: PointOfSaleContext, terminalId: string): Promise<any[]>;
export declare function getCurrentTerminalSession(client: any, context: PointOfSaleContext, terminalId: string): Promise<any | null>;
export declare function getTerminalTransactions(client: any, context: PointOfSaleContext, terminalId: string, filters?: Record<string, string>): Promise<any[]>;
export declare function getTerminalHistory(client: any, context: PointOfSaleContext, terminalId: string): Promise<any[]>;
export declare function openShift(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;

// Cashiers (cashiers/index.js).
export declare class PosCashierError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown);
}
export declare function normalizeCashierCode(value: unknown): string;
export declare function cashierCapabilities(context: PointOfSaleContext): Record<string, boolean>;
export declare function listCashiers(client: any, context: PointOfSaleContext, filters?: Record<string, string | undefined>): Promise<{ cashiers: any[]; capabilities: Record<string, boolean> }>;
export declare function getCashier(client: any, context: PointOfSaleContext, cashierId: string): Promise<any>;
export declare function getCashierOptions(client: any, context: PointOfSaleContext): Promise<any>;
export declare function createCashier(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function updateCashier(client: any, context: PointOfSaleContext, cashierId: string, input: Record<string, any>): Promise<any>;
export declare function setCashierOutlets(client: any, context: PointOfSaleContext, cashierId: string, outletIds: string[], options?: { defaultOutletId?: string | null }): Promise<any>;
export declare function assignOutletAccess(client: any, context: PointOfSaleContext, cashierId: string, outletId: string): Promise<any>;
export declare function removeOutletAccess(client: any, context: PointOfSaleContext, cashierId: string, outletId: string): Promise<any>;
export declare function setDefaultOutlet(client: any, context: PointOfSaleContext, cashierId: string, outletId: string | null): Promise<any>;
export declare function validateCashierSetup(client: any, context: PointOfSaleContext, cashierId: string): Promise<Array<{ code: string; field: string; message: string }>>;
export declare function validateCashierForDeactivation(client: any, context: PointOfSaleContext, cashierId: string): Promise<Array<{ code: string; message: string }>>;
export declare function setCashierStatus(client: any, context: PointOfSaleContext, cashierId: string, status: string, input?: { reason?: string }): Promise<any>;
export declare function deleteCashier(client: any, context: PointOfSaleContext, cashierId: string): Promise<{ deleted: true }>;
export declare function validateCashierOperationAccess(client: any, context: PointOfSaleContext, outletId: string, userId?: string | null): Promise<any>;
export declare function assertCashierCanOpenSession(client: any, context: PointOfSaleContext, input: { outletId: string; userId?: string | null }): Promise<any>;
export declare function openPosForCashier(client: any, context: PointOfSaleContext, cashierId: string): Promise<any>;
export declare function getCurrentCashierSession(client: any, context: PointOfSaleContext, cashierId: string): Promise<any | null>;
export declare function getCashierSessions(client: any, context: PointOfSaleContext, cashierId: string): Promise<any[]>;
export declare function getCashierTransactions(client: any, context: PointOfSaleContext, cashierId: string, filters?: Record<string, string>): Promise<any[]>;
export declare function getCashierHistory(client: any, context: PointOfSaleContext, cashierId: string): Promise<any[]>;
export declare function listOutletCashiers(client: any, context: PointOfSaleContext, outletId: string): Promise<any[]>;
export declare function completePointOfSale(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function findPosSaleForReturn(client: any, context: PointOfSaleContext, input: { receiptNumber: string }): Promise<{ sale: Record<string, any>; lines: Record<string, any>[] }>;
export declare function createPointOfSaleReturn(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function approvePointOfSaleReturn(client: any, context: PointOfSaleContext, returnId: string, input?: Record<string, any>): Promise<any>;
export declare function completePointOfSaleReturn(client: any, context: PointOfSaleContext, returnId: string, input?: Record<string, any>): Promise<any>;

export declare function closeShift(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;
export type PosShiftPaymentBreakdown = { payment_method: string; status: string; amount: string; count: number };
export type PosShiftSaleSummary = { id: string; receipt_number: string; customer_name: string | null; grand_total: string; status: string; created_at: string };
export declare function getPosShift(client: any, context: PointOfSaleContext, shiftId: string): Promise<Record<string, any> & { cashMovements: any[]; sales: PosShiftSaleSummary[]; paymentBreakdown: PosShiftPaymentBreakdown[] }>;

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

// F304 — payment reconciliation.
export type PosSettlementBatch = { id: string; organization_id: string; store_id: string | null; payment_method: string; provider_key: string; batch_reference: string; settlement_date: string; total_amount: string; total_fee_amount: string; entry_count: number; status: "imported" | "matched" | "closed"; [key: string]: any };
export type PosSettlementEntry = { id: string; batch_id: string; provider_reference: string; amount: string; fee_amount: string; settled_at: string; matched_payment_id: string | null; match_status: "unmatched" | "matched" | "duplicate"; [key: string]: any };
export type PosReconciliation = { id: string; organization_id: string; store_id: string | null; day_end_report_id: string | null; shift_id: string | null; payment_method: string; reconciliation_number: string | null; expected_amount: string; counted_amount: string; settled_amount: string; variance_amount: string; fee_total: string; missing_count: number; duplicate_count: number; status: "draft" | "matched" | "variance" | "resolved"; matched_by: string | null; matched_at: string | null; resolved_by: string | null; resolved_at: string | null; resolution_notes: string | null; approved_by: string | null; approved_at: string | null; [key: string]: any };
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

// F305 gap closure — account-mapping configuration (wraps Accounting's own
// getAccountingSettings/getAccountingOptions/upsertAccountMapping).
export type PosMappingKeyDefinition = { key: string; label: string; description: string; seeded: boolean };
export declare const POS_MAPPING_KEYS: readonly PosMappingKeyDefinition[];
export type PosAccountingMappingRow = PosMappingKeyDefinition & { configured: boolean; accountId: string | null; accountCode: string | null; accountName: string | null };
export declare function getPosAccountingMappingConfig(client: any, context: PointOfSaleContext): Promise<{ ledger: Record<string, any> | null; accounts: Record<string, any>[]; mappings: PosAccountingMappingRow[] }>;
export declare function upsertPosAccountingMapping(client: any, context: PointOfSaleContext, input: { mappingKey: string; accountId: string }): Promise<Record<string, any>>;

// Product Search (migration 0084).
export type PosProductReasonCode = "POS_PRODUCT_NOT_FOUND" | "POS_PRODUCT_INACTIVE" | "POS_PRODUCT_NOT_SELLABLE" | "POS_PRODUCT_OUTLET_RESTRICTED" | "POS_PRODUCT_OUT_OF_STOCK"
  | "POS_PRODUCT_INSUFFICIENT_STOCK" | "POS_PRODUCT_PRICE_MISSING" | "POS_PRODUCT_BARCODE_AMBIGUOUS" | "POS_PRODUCT_UOM_INVALID" | "POS_PRODUCT_SELECTION_REQUIRED"
  | "POS_PRODUCT_CHANGED" | "POS_SEARCH_UNAVAILABLE" | "POS_SESSION_REQUIRED" | "POS_PERMISSION_DENIED";
export type PosProductResult = {
  itemId: string; variantId: string | null; parentItemId: string | null; parentName: string | null; variantLabel: string | null; sku: string; name: string; brand: string | null;
  description: string | null; imageUrl: string | null; categoryId: string | null; categoryName: string | null; itemType: string; isVariantGroup: boolean; saleUomId: string;
  saleUomCode: string | null; saleUomName: string | null; uomFactor: string; barcodeMatchType: "barcode" | "sku" | null; matchRank: number | null; displayPrice: string | null;
  currency: string; taxInclusive: boolean; stockStatus: "in_stock" | "low_stock" | "out_of_stock" | "unavailable" | "not_tracked" | null; availableQuantity: string | null;
  requiresTracking: "batch" | "serial" | null; isSellableNow: boolean; unavailableReason: { code: PosProductReasonCode; message: string } | null; catalogVersion: number;
  priceQuoteVersion: string | null; source?: "configured" | "frequent";
};
export type PosProductOutlet = { id: string; code: string; name: string; currency: string; showStockStatus: boolean; showQuantity: boolean;
  priceList: { id: string; name: string; taxInclusive: boolean } | null };
export type PosProductLocator = { cartId?: string | null; outletId?: string | null };
export type PosBarcodeLookup = { barcode: string; outlet?: PosProductOutlet; message: string | null } & (
  | { status: "matched"; product: PosProductResult; autoAdd: boolean }
  | { status: "ambiguous"; code: "POS_PRODUCT_BARCODE_AMBIGUOUS"; candidates: PosProductResult[] }
  | { status: "selection_required"; code: "POS_PRODUCT_SELECTION_REQUIRED"; product: PosProductResult; variants: PosProductResult[] }
  | { status: "not_found"; code: "POS_PRODUCT_NOT_FOUND" });
export type PosOutletProductSettings = {
  outlet: { id: string; code: string; name: string };
  allCategories: Array<{ id: string; name: string; parentId: string | null }>;
  settings: { assortmentPolicy: "all_sellable" | "selected_categories"; categoryIds: string[]; categories: Array<{ id: string; name: string; parentId: string | null }>;
    showStockStatus: boolean; showExactStock: boolean; lowStockThreshold: string; suggestFrequent: boolean; version: number };
  quickProducts: Array<{ id: string; itemId: string; uomId: string | null; uomCode: string | null; sku: string; name: string; sortOrder: number; sellable: boolean }>;
  capabilities: { edit: boolean };
};
export declare const POS_PRODUCT_MESSAGES: Readonly<Record<PosProductReasonCode, string>>;
export declare function searchPosProducts(client: any, context: PointOfSaleContext, input?: PosProductLocator & { query?: string; categoryId?: string | null; cursor?: string | null; limit?: number }):
  Promise<{ products: PosProductResult[]; nextCursor: string | null; outlet: PosProductOutlet; sessionOpen?: boolean; unavailable?: { code: "POS_SEARCH_UNAVAILABLE"; message: string } }>;
export declare function lookupPosProductByBarcode(client: any, context: PointOfSaleContext, input: PosProductLocator & { barcode: string }): Promise<PosBarcodeLookup>;
export declare function getPosProductDetails(client: any, context: PointOfSaleContext, itemId: string, input?: PosProductLocator):
  Promise<{ product: PosProductResult; units: PosProductResult[]; variants: PosProductResult[]; outlet: PosProductOutlet }>;
export declare function listPosProductCategories(client: any, context: PointOfSaleContext, input?: PosProductLocator):
  Promise<{ categories: Array<{ id: string; name: string; parentId: string | null; sortOrder: number }>; outlet: PosProductOutlet }>;
export declare function getPosQuickProducts(client: any, context: PointOfSaleContext, input?: PosProductLocator): Promise<{ products: PosProductResult[]; outlet: PosProductOutlet }>;
export declare function getPosOutletProductSettings(client: any, context: PointOfSaleContext, outletId: string): Promise<PosOutletProductSettings>;
export declare function updatePosOutletProductSettings(client: any, context: PointOfSaleContext, outletId: string, input: Record<string, any>): Promise<PosOutletProductSettings>;
export declare function setPosQuickProducts(client: any, context: PointOfSaleContext, outletId: string, entries: Array<{ itemId: string; uomId?: string | null }>): Promise<PosOutletProductSettings>;
export declare function validatePosProductSelection(client: any, context: PointOfSaleContext, ctx: any, input: Record<string, any>): Promise<Record<string, any>>;
export declare function resolvePosProductContext(client: any, context: PointOfSaleContext, input?: PosProductLocator): Promise<Record<string, any>>;
export declare function assertPosCartProductsSellable(client: any, context: PointOfSaleContext, cartId: string): Promise<void>;
// Barcode Scanning (migration 0085).
export type PosScanProduct = Pick<PosProductResult, "itemId" | "sku" | "name" | "variantLabel" | "saleUomCode" | "uomFactor" | "displayPrice" | "currency" | "imageUrl" | "requiresTracking">;
export type PosScanLine = { id: string; quantity: string; uomCode: string | null; unitPrice: string; lineTotal: string; serialId: string | null; batchId: string | null };
export type PosScanOutcome = { barcode: string; scanActionId: string; message: string; replayed?: boolean; cart?: PosCart } & (
  | { status: "added"; code: null; product: PosScanProduct; line: PosScanLine | null }
  | { status: "selection_required"; reason: "ambiguous" | "variant"; code: string; candidates: PosProductResult[] }
  | { status: "serial_required"; code: string; product: PosScanProduct; reason?: string | null }
  | { status: "batch_required"; code: "POS_BATCH_REQUIRED"; product: PosScanProduct; options: Array<{ batchId: string; batch: string; expiresOn: string | null; available: number }> }
  | { status: "rejected"; code: string; product?: PosScanProduct; detail?: string });
export type PosScannerSettings = { terminalId: string; enabled: boolean; inputMode: "keyboard_wedge"; prefix: string | null; suffix: "enter" | "tab" | "custom"; suffixCustom: string | null;
  successSound: boolean; errorSound: boolean; version: number; capabilities?: { edit: boolean } };
export declare const POS_SCAN_MESSAGES: Readonly<Record<string, string>>;
export declare function processPosScan(client: any, context: PointOfSaleContext, cartId: string, input: { barcode: string; scanActionId: string; itemId?: string | null; serialNumber?: string | null;
  batchId?: string | null; expectedCartVersion?: number }): Promise<PosScanOutcome>;
export declare function validateScannedSerial(client: any, context: PointOfSaleContext, ctx: any, input: Record<string, any>): Promise<{ serialId: string; batchId: string | null; serialNumber: string }>;
export declare function allocateScannedBatch(client: any, context: PointOfSaleContext, ctx: any, input: Record<string, any>): Promise<Record<string, any>>;
export declare function getScannerConfiguration(client: any, context: PointOfSaleContext, terminalId: string): Promise<PosScannerSettings>;
export declare function updateScannerConfiguration(client: any, context: PointOfSaleContext, terminalId: string, input: Record<string, any>): Promise<PosScannerSettings>;
export declare function recordScanDiagnostic(client: any, context: PointOfSaleContext, details: Record<string, any>): Promise<void>;
export declare function listScanDiagnostics(client: any, context: PointOfSaleContext, input?: { result?: string | null; limit?: number }): Promise<Array<Record<string, any>>>;
export declare function findPosSaleLineByBarcode(client: any, context: PointOfSaleContext, saleId: string, input: { barcode: string; serialNumber?: string | null }):
  Promise<{ saleLineId: string; itemId: string; description: string; uomCode: string | null; serialNumber: string | null; soldQuantity: string; remainingQuantity: string }>;
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
export type PosCartLifecycle = "DRAFT" | "CHECKOUT_PENDING" | "HELD" | "COMPLETED" | "CANCELLED" | "EXPIRED";
export type PosCartIssue = { code: string; message: string; lineId?: string; itemId?: string; previousTotal?: string; currentTotal?: string };
export type PosCart = {
  id: string;
  status: "draft" | "priced" | "held" | "completed" | "cancelled" | "expired";
  lifecycle?: PosCartLifecycle;
  cart_reference?: string | null;
  notes?: string | null;
  hold_note?: string | null;
  checkout_started_at?: string | null;
  checkout_reference?: string | null;
  customer_name?: string | null;
  resumeChanges?: PosCartIssue[];
  replayed?: boolean;
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
  /** Discount-approval rows bound to this cart's CURRENT version (F279-APP-001). */
  discountApprovals?: Array<{ id: string; approval_request_id: string | null; cart_line_id: string | null; status: "pending" | "approved" | "rejected"; discount_amount_snapshot: string; discount_percent_snapshot: string | null; reason: string }>;
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
export declare const POS_CART_MESSAGES: Readonly<Record<string, string>>;
export declare function cartLifecycle(cart: { status: string; checkout_started_at?: string | null }): PosCartLifecycle;
export declare function getActivePosCart(client: any, context: PointOfSaleContext): Promise<{ session: { id: string; storeId: string; terminalId: string } | null; cart: PosCart | null; heldCount: number }>;
export declare function setPosCartNotes(client: any, context: PointOfSaleContext, cartId: string, input: { notes?: string | null; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function overridePosCartLinePrice(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: Record<string, any>): Promise<PosCart>;
export type PosCheckoutSnapshot = Record<string, any> & { cartId: string; version: number; checkoutReference: string; totals: Record<string, string> };
export declare function validatePosCartForCheckout(client: any, context: PointOfSaleContext, cartId: string): Promise<{ ready: boolean; lifecycle: PosCartLifecycle; version: number; issues: PosCartIssue[] }>;
export declare function beginPosCheckout(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number; idempotencyKey?: string }):
  Promise<{ ready: boolean; issues: PosCartIssue[]; cart: PosCart; snapshot?: PosCheckoutSnapshot; code?: string; message?: string; replayed?: boolean }>;
export declare function ensurePosCheckoutStarted(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCart>;
export declare function releasePosCheckout(client: any, context: PointOfSaleContext, cartId: string, input?: { reason?: string }): Promise<PosCart>;
export declare function getPosCartHistory(client: any, context: PointOfSaleContext, cartId: string): Promise<Array<{ id: string; eventType: string; summary: string; changes: Record<string, unknown>;
  version: number | null; at: string; actor: string | null; terminal: string | null }>>;
// Walk-In Customer (migration 0087).
export type PosCustomerContext = {
  cartId: string; cartVersion: number; contextVersion: number; mode: "WALK_IN" | "REGISTERED"; displayName: string | null;
  customer: { id: string; name: string | null; phone: string | null; gstin: string | null } | null;
  buyerDetails: { name: string | null; address: { line1?: string; line2?: string; city?: string; stateCode?: string; postalCode?: string } } | null;
  receiptContact: { phone: string | null; email: string | null; consent: boolean; masked: boolean };
  policy: { allowWalkIn: boolean; allowBuyerName: boolean; allowReceiptContact: boolean; buyerDetailsRequiredAbove: string | null };
  buyerDetailsRequired: boolean; buyerDetailsComplete: boolean;
};
export declare const POS_CUSTOMER_MESSAGES: Readonly<Record<string, string>>;
export declare function getPosCustomerContext(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCustomerContext>;
export declare function setWalkInCustomer(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function selectPosCustomer(client: any, context: PointOfSaleContext, cartId: string, input: { customerId: string; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function updateWalkInBuyerDetails(client: any, context: PointOfSaleContext, cartId: string, input: { name?: string | null; address?: Record<string, string | null>;
  gstin?: string | null; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function setReceiptDeliveryContact(client: any, context: PointOfSaleContext, cartId: string, input: { phone?: string | null; email?: string | null; consent?: boolean;
  expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function buildPosBuyerSnapshot(client: any, context: PointOfSaleContext, cart: any): Promise<Record<string, any>>;
export type PosReceiptDelivery = { id: string; channel: "email" | "sms"; destination: string; status: "pending" | "sent" | "failed" | "not_configured"; error: string | null; attempts: number;
  at: string; sentAt: string | null };
export declare function sendPosDigitalReceipts(client: any, context: PointOfSaleContext, saleId: string, input?: { channel?: "email" | "sms"; destination?: string; consent?: boolean;
  resend?: boolean }): Promise<PosReceiptDelivery[]>;
export declare function listPosReceiptDeliveries(client: any, context: PointOfSaleContext, saleId: string): Promise<PosReceiptDelivery[]>;
export type PosWalkInFigures = { transactions: number; gross: string; discounts: string; tax: string; refunds: string; net: string; averageBill: string };
export declare function getWalkInSalesSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string; storeId?: string }): Promise<{
  from: string; to: string; currency: string; walkIn: PosWalkInFigures; registered: PosWalkInFigures; walkInByOutlet: Array<{ code: string; name: string; transactions: number; net: string }>;
  walkInByPaymentMethod: Array<{ method: string; transactions: number; amount: string }>; note: string }>;
export declare function quickCreatePosCustomer(client: any, context: PointOfSaleContext, input: { name: string; phone?: string | null; email?: string | null; gstin?: string | null; cartId?: string | null }):
  Promise<{ id: string; code: string | null; displayName: string; phone: string | null; email: string | null }>;
export declare function addPosCartLine(client: any, context: PointOfSaleContext, cartId: string, input: Record<string, any>): Promise<PosCart>;
export declare function addProductToPosCart(client: any, context: PointOfSaleContext, cartId: string, input: Record<string, any>): Promise<PosCart & { replayed?: boolean }>;
export declare function updatePosCartLineQuantity(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { quantity: number | string; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function removePosCartLine(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function setPosCartLineTracking(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { batchId?: string | null; serialId?: string | null; serialNumber?: string | null; batchNumber?: string | null; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
// Manual discounts are authorized by the cashier's permission profile; above its limits, pass the approvalId of a supervisor approval.
export declare function applyPosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { type: "percent" | "amount"; value: number; reason: string; expectedVersion?: number; approvalId?: string; idempotencyKey?: string }): Promise<PosCart>;
export declare function removePosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function setPosCartDiscount(client: any, context: PointOfSaleContext, cartId: string, input: { type?: "percent" | "amount" | null; value?: number; reason?: string; expectedVersion?: number; approvalId?: string; idempotencyKey?: string }): Promise<PosCart>;
export declare function assertPosCartDiscountsAuthorized(client: any, context: PointOfSaleContext, cart: PosCart): Promise<void>;
export declare function setPosCartCustomer(client: any, context: PointOfSaleContext, cartId: string, input: { customerId: string | null; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function holdPosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number; note?: string | null; idempotencyKey?: string }): Promise<PosCart>;
export declare function resumePosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { idempotencyKey?: string }): Promise<PosCart>;
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
  cart_reference: string | null;
  currency_code: string;
  created_at: string;
  hold_note: string | null;
  held_by: string;
  cashier_name: string | null;
  own: boolean;
};
export declare function listHeldPosCarts(client: any, context: PointOfSaleContext, options?: { search?: string; scope?: "mine" | "all"; from?: string; to?: string }): Promise<PosHeldCart[]>;

// F289 receipts
export type PosReceiptPrintEvent = {
  id: string;
  print_type: "original" | "reprint";
  requested_at: string;
  requested_by_name: string | null;
};
export declare function getPosSaleReceipt(client: any, context: PointOfSaleContext, saleId: string): Promise<{
  sale: Record<string, any>;
  lines: Record<string, any>[];
  payments: Record<string, any>[];
  returns: Record<string, any>[];
  promotionEvidence: Record<string, any>[];
  printEvents: PosReceiptPrintEvent[];
}>;
export declare function recordPosReceiptPrintAttempt(client: any, context: PointOfSaleContext, saleId: string): Promise<PosReceiptPrintEvent>;
export declare function listPosReceiptPrintEvents(client: any, context: PointOfSaleContext, saleId: string): Promise<PosReceiptPrintEvent[]>;

// Transactions workspace — search/drill-down over completed sales.
export type PosTransactionListOptions = {
  search?: string;
  storeId?: string;
  terminalId?: string;
  cashierId?: string;
  shiftId?: string;
  customerId?: string;
  customerMode?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  sortBy?: "sale_date" | "grand_total" | "receipt_number" | "status";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};
export declare function listPosTransactions(client: any, context: PointOfSaleContext, options?: PosTransactionListOptions): Promise<{ rows: Record<string, any>[]; total: number }>;
export declare function getPosTransactionDetail(client: any, context: PointOfSaleContext, saleId: string): Promise<{
  sale: Record<string, any>;
  lines: Record<string, any>[];
  payments: Record<string, any>[];
  returns: Record<string, any>[];
  promotionEvidence: Record<string, any>[];
  stockMovements: Record<string, any>[];
  auditTrail: Record<string, any>[];
}>;
export declare function cancelPosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { reason?: string; idempotencyKey?: string }): Promise<PosCart>;
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

// F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286 (multiple
// payment methods): ONE payment-tender subsystem. Field names are
// snake_case, matching tenant.pos_payments directly (same convention as
// PosCart/PosCartLine above).
export type PosPaymentMethod = "cash" | "card" | "upi" | "wallet" | "bank_transfer" | "store_credit";
export type PosPaymentStatus = "initiated" | "pending" | "authorized" | "captured" | "failed" | "voided" | "refunded" | "partially_refunded";
export type PosPayment = {
  id: string;
  organization_id: string;
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
  parseWebhookEvent: (rawBody: string) => { eventId: string; eventType: string; organizationId: string; paymentId: string; providerReference: string | null; status: string; failureReason: string | null; raw: unknown };
};
export declare function resolvePaymentAdapter(providerKey: string): PosPaymentAdapter;
export declare class PaymentAdapterError extends Error {
  status: number;
  code: string;
}

// F294/F296 -- read-only store inventory/stock-sync-activity visibility.
export type PosStoreInventoryRow = {
  item_id: string;
  item_code: string;
  item_name: string;
  barcode: string | null;
  tracking_type: "none" | "batch" | "serial";
  warehouse_location_id: string | null;
  location_code: string | null;
  batch_id: string | null;
  batch_number: string | null;
  expires_on: string | null;
  on_hand_quantity: string;
  reserved_quantity: string;
  available_quantity: string;
  updated_at: string;
  quality_held: boolean;
};
export type PosStoreRef = { id: string; code: string; name: string; warehouse_id: string };
export declare function listPosStoreInventory(client: any, context: PointOfSaleContext, options: { storeId: string; search?: string; limit?: number; offset?: number }): Promise<{ store: PosStoreRef; rows: PosStoreInventoryRow[] }>;
export type PosStoreStockActivityRow = {
  id: string;
  movement_number: string;
  movement_type: "receipt" | "issue" | "adjustment";
  item_id: string;
  item_code: string;
  item_name: string;
  quantity: string;
  unit_cost: string;
  reference_type: string;
  reference_id: string;
  occurred_at: string;
  sale_id: string | null;
  sale_receipt_number: string | null;
  return_id: string | null;
  return_number: string | null;
};
export declare function listPosStoreStockActivity(client: any, context: PointOfSaleContext, options: { storeId: string; limit?: number; offset?: number }): Promise<{ store: PosStoreRef; rows: PosStoreStockActivityRow[] }>;

// Cashier Permissions (permissions/index.js).
export declare class PosPermissionError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown);
}
export type CashierPermissionEntry = { code: string; area: string; label: string; description: string; limits: Array<"percentage" | "amount">; limitRequired: boolean; reason: boolean; approval: string | null };
export declare const CASHIER_PERMISSION_CATALOGUE: readonly CashierPermissionEntry[];
export declare const PERMISSION_AREAS: ReadonlyArray<{ code: string; label: string }>;
export type PosActionRequest = { permission: string; outletId?: string | null; amount?: string | number | null; percentage?: string | number | null; reason?: string | null; approvalId?: string | null; resource?: { type: string; id: string; version?: number | null } };
export type PosActionDecision = { decision: "ALLOW" | "DENY" | "REQUIRES_APPROVAL"; reasonCode: string; message?: string; approvalCode?: string | null; approvalId?: string | null; [key: string]: any };
export declare function normalizeProfileCode(value: unknown): string;
export declare function permissionProfileCapabilities(context: PointOfSaleContext): Record<string, boolean>;
export declare function listPermissionProfiles(client: any, context: PointOfSaleContext, filters?: Record<string, string | undefined>): Promise<{ profiles: any[]; capabilities: Record<string, boolean> }>;
export declare function getPermissionProfile(client: any, context: PointOfSaleContext, profileId: string): Promise<any>;
export declare function createPermissionProfile(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function updatePermissionProfile(client: any, context: PointOfSaleContext, profileId: string, input: Record<string, any>): Promise<any>;
export declare function clonePermissionProfile(client: any, context: PointOfSaleContext, profileId: string, input?: { code?: string; name?: string }): Promise<any>;
export declare function validatePermissionProfile(client: any, context: PointOfSaleContext, profileId: string): Promise<Array<{ code: string; message: string }>>;
export declare function setPermissionProfileStatus(client: any, context: PointOfSaleContext, profileId: string, status: string): Promise<any>;
export declare function activatePermissionProfile(client: any, context: PointOfSaleContext, profileId: string): Promise<any>;
export declare function deactivatePermissionProfile(client: any, context: PointOfSaleContext, profileId: string): Promise<any>;
export declare function deletePermissionProfile(client: any, context: PointOfSaleContext, profileId: string): Promise<{ deleted: true }>;
export declare function assignPermissionProfile(client: any, context: PointOfSaleContext, cashierId: string, profileId: string | null): Promise<{ cashierId: string; profileId: string | null }>;
export declare function getPermissionProfileAuditHistory(client: any, context: PointOfSaleContext, profileId: string): Promise<any[]>;
export declare function getEffectivePosPermissions(client: any, context: PointOfSaleContext, userId?: string | null): Promise<any | null>;
export declare function getCashierEffectivePermissionSummary(client: any, context: PointOfSaleContext, cashierId: string): Promise<any>;
export declare function authorizePosAction(client: any, context: PointOfSaleContext, request: PosActionRequest): Promise<PosActionDecision>;
export declare function assertPosAction(client: any, context: PointOfSaleContext, request: PosActionRequest): Promise<PosActionDecision>;
export declare function validatePermissionLimits(grant: any, request: PosActionRequest): string | null;
export declare function requestSupervisorApproval(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function getPosApproval(client: any, context: PointOfSaleContext, approvalId: string): Promise<any>;
export declare function listPosApprovals(client: any, context: PointOfSaleContext, options?: { status?: string; mine?: boolean }): Promise<any[]>;
export declare function approvePosException(client: any, context: PointOfSaleContext, approvalId: string, input?: { note?: string }): Promise<any>;
export declare function rejectPosException(client: any, context: PointOfSaleContext, approvalId: string, input?: { note?: string }): Promise<any>;
export declare function validateApproval(client: any, context: PointOfSaleContext, approvalId: string, expectation: Record<string, any>): Promise<any>;
export declare function consumeApprovalAtomically(client: any, context: PointOfSaleContext, approvalId: string, expectation: Record<string, any>): Promise<any>;
export declare function getCashierPermissionCatalogue(): { permissions: readonly CashierPermissionEntry[]; areas: ReadonlyArray<{ code: string; label: string }> };

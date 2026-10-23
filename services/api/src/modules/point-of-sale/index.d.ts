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
  stock_reservation_max_hold_minutes?: number;
  opening_variance_approval_above?: string | number | null;
  opening_variance_block_above?: string | number | null;
  opening_count_denominations?: number[];
  long_open_shift_hours?: number;
  closing_variance_approval_above?: string | number | null;
  closing_variance_block_above?: string | number | null;
  closing_blind_count?: boolean;
  closing_reveal_expected_after_count?: boolean;
  closing_variance_reasons?: string[];
  closing_shortage_approval_above?: string | number | null;
  closing_overage_approval_above?: string | number | null;
  closing_shortage_block_above?: string | number | null;
  closing_overage_block_above?: string | number | null;
  cash_difference_unknown_note_required?: boolean;
  reconciliation_unknown_after_minutes?: number;
  reconciliation_refund_overdue_days?: number;
  reconciliation_manual_approval_above?: string | number | null;
  walk_in_buyer_details_required_above: string | null;
  manual_discount_stacking: "non_stackable" | "stackable" | "manual_replaces_automatic";
  allow_full_line_discount: boolean;
  discount_reason_required: boolean;
  allow_zero_total_sale?: boolean;
  cash_payments_enabled?: boolean;
  cash_quick_amounts_enabled?: boolean;
  max_cash_tender_amount?: string | null;
  large_cash_warning_amount?: string | null;
  split_payments_enabled?: boolean;
  refund_allocation_policy?: "proportional" | "electronic_first";
  receipt_reprint_reason_required?: boolean;
  returns_enabled?: boolean;
  return_window_days?: number | null;
  allow_no_receipt_returns?: boolean;
  require_return_reason?: boolean;
  require_return_condition?: boolean;
  allow_partial_returns?: boolean;
  allow_cross_outlet_returns?: boolean;
  require_inspection_before_refund?: boolean;
  return_approval_above?: string | null;
  return_reasons?: string[];
  return_restrictions?: Array<{ type: "item" | "category"; id: string; mode: "blocked" | "approval" }>;
};
export type PosSettings = { configured: boolean; updatedAt: string | null; settings: PosSettingsValues };
export declare const POS_SETTINGS_DEFAULTS: Readonly<PosSettingsValues>;
export declare function getPosSettings(client: any, context: PointOfSaleContext): Promise<PosSettings>;
export declare function updatePosSettings(client: any, context: PointOfSaleContext, input: Partial<Record<keyof PosSettingsValues, string | number | boolean | null | string[] | number[] | Array<{ type: "item" | "category"; id: string; mode: "blocked" | "approval" }>>>): Promise<PosSettings>;
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
// POS Shift Opening (0103)
export declare const POS_SHIFT_MESSAGES: Readonly<Record<string, string>>;
export type PosShiftPaymentMethods = { cash: boolean; card: boolean; upi: boolean };
export type PosShiftHandover = { id: string; fromShiftNumber?: string; handedOverBy?: string | null; handedOverAt?: string; amount?: string; variance?: string | null; reason?: string | null;
  approved?: boolean };
export type PosShiftSession = {
  shiftId: string; shiftNumber: string; status: "OPENING" | "OPEN" | "SUSPENDED" | "CLOSING" | "CLOSED" | "RECOVERY_REQUIRED" | "FORCE_CLOSED"; storeId: string; storeName: string;
  terminalId: string; terminalCode: string; terminalName: string; cashierUserId: string; cashierName: string | null; openedAt: string; closedAt: string | null; cashEnabled: boolean;
  cashSessionId: string | null; cashSessionStatus: string | null; openingCashAmount: string | null; currency: string; openingSource: string | null;
  denominations: Array<{ denomination: number; count: number; amount: string }> | null; openingConfirmedAt: string | null; previousShiftNumber: string | null;
  handover: PosShiftHandover | null; paymentMethods: PosShiftPaymentMethods; readyForCheckout: boolean; version: number;
  suspension: { at: string; reason: string | null; byCashier: boolean } | null; review: { reason: string | null; flaggedAt: string; resolution: string | null; resolvedAt: string | null } | null;
};
export type PosShiftOpeningInput = {
  terminalId: string; storeId?: string; cashEnabled?: boolean; openingCash?: string; openingCashAmount?: string; denominations?: Array<{ denomination: number; count: number }>;
  openingCashConfirmed?: boolean; varianceReason?: string; approvalId?: string | null; expectedTerminalVersion?: number; notes?: string; idempotencyKey: string;
};
export type PosShiftOpeningPreview = {
  action: "OPEN" | "RESTORE"; shift?: PosShiftSession; terminalId: string; terminalCode: string; storeId: string; storeName: string; terminalVersion: number; cashEnabled: boolean;
  openingCashAmount: string | null; denominations: unknown; handover: PosShiftHandover | null; approvalRequired: boolean; approvalFingerprint: string | null; approvalAmount: string | null;
  paymentMethods: PosShiftPaymentMethods; warnings: Array<{ code: string; message: string }>; readyToOpen: boolean;
};
export type PosShiftCounter = { terminalId: string; code: string; name: string; storeId: string; storeName: string; cashCounter: boolean; occupied: boolean; mine: boolean;
  occupiedBy: string | null };
export declare function openShift(client: any, context: PointOfSaleContext, input: PosShiftOpeningInput): Promise<any & PosShiftSession & { restored?: boolean; replayed?: boolean }>;
export declare function previewShiftOpening(client: any, context: PointOfSaleContext, input: Partial<PosShiftOpeningInput> & { terminalId: string }): Promise<PosShiftOpeningPreview>;
export declare function getShiftOpeningContext(client: any, context: PointOfSaleContext, input?: { terminalId?: string }): Promise<{ company: string | null; cashier: { userId: string };
  currentShift: PosShiftSession | null; counters: PosShiftCounter[]; selectedTerminalId: string | null; readiness: unknown; denominations: number[] }>;
export declare function openPosCashSession(client: any, context: PointOfSaleContext, shiftId: string, input: { openingCash?: string; denominations?: Array<{ denomination: number; count: number }>;
  openingCashConfirmed: boolean; varianceReason?: string; approvalId?: string | null }): Promise<PosShiftSession>;
export declare function getCurrentPosShift(client: any, context: PointOfSaleContext): Promise<PosShiftSession | null>;
export declare function getTerminalHandover(client: any, context: PointOfSaleContext, terminalId: string): Promise<(PosShiftHandover & { closingCounted?: string; removed?: string; removalNote?: string | null }) | null>;
export declare function getPosShiftSession(client: any, context: PointOfSaleContext, shiftId: string): Promise<PosShiftSession>;
export declare function assertShiftCashSession(client: any, context: PointOfSaleContext, shiftId: string): Promise<void>;
export declare function assertShiftOperational(client: any, context: PointOfSaleContext, shiftId: string): Promise<void>;
export declare function recordShiftOpeningAttempt(client: any, context: PointOfSaleContext, input: { terminalId?: string | null; storeId?: string | null; outcome: "opened" | "restored" | "denied" | "failed";
  code?: string | null; message?: string | null; sessionId?: string | null }): Promise<void>;
export declare function listPosShiftOpenings(client: any, context: PointOfSaleContext, filters?: { from?: string; to?: string; storeId?: string; terminalId?: string; cashierUserId?: string;
  status?: string; limit?: number; offset?: number }): Promise<{ rows: PosShiftSession[]; total: number }>;
export declare function getShiftOpeningSummary(client: any, context: PointOfSaleContext, input?: { from?: string | null; to?: string | null }): Promise<{ from: string; to: string;
  totals: { openings: number; cashShifts: number; digitalShifts: number; openingFloats: string; variances: number; varianceTotal: string; approvedOpenings: number; handoversWaiting: number };
  openByOutlet: Array<{ outlet: string; openShifts: number; activeCounters: number }>; longOpen: Array<{ shiftId: string; shiftNumber: string; terminal: string; cashier: string | null; openedAt: string }>;
  refusals: Array<{ code: string; attempts: number }>; longOpenHours: number }>;

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

// F304 — payment reconciliation.

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
  | "POS_PRODUCT_CHANGED" | "POS_SEARCH_UNAVAILABLE" | "POS_SESSION_REQUIRED" | "POS_PERMISSION_DENIED" | "POS_TAX_ITEM_CLASSIFICATION_MISSING" | "POS_TAX_HSN_SAC_INVALID";
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
// Named Customer (migration 0088): POS's window onto the Customer Master.
export type PointOfSaleCustomerMatch = {
  id: string; code: string; name: string; legalName: string | null; type: "individual" | "business"; status: "active" | "inactive" | "blocked"; gstRegistered: boolean;
  phone: string | null; phoneEnding: string | null; email: string | null; city: string | null; state: string | null;
};
export type PosCustomerBillingAddress = {
  id: string; label: string | null; line1: string; line2?: string | null; city: string | null; state: string | null; stateCode: string | null; postalCode: string | null;
  gstin?: string | null; isDefault: boolean;
};
export type PosCustomerPreview = PointOfSaleCustomerMatch & {
  gstin: string | null; priceList: { id: string; name: string } | null; billingAddresses: PosCustomerBillingAddress[]; eligible: boolean; ineligibleReason: string | null;
  purchases: { total: number; lastAt: string | null };
};
export type PosCustomerPurchase = {
  id: string; receiptNumber: string; completedAt: string; outlet: { code: string; name: string }; currency: string; total: string; paymentStatus: "paid" | "partially_paid";
  paymentMethods: string[]; status: string; refunded: string;
};
export declare function searchPointOfSaleCustomers(client: any, context: PointOfSaleContext, input?: { query?: string; cartId?: string | null; limit?: number; offset?: number }):
  Promise<{ rows: PointOfSaleCustomerMatch[]; total: number; limit: number; offset: number }>;
export declare function getPosCustomerPreview(client: any, context: PointOfSaleContext, customerId: string, input?: { cartId?: string | null }): Promise<PosCustomerPreview>;
export declare function listPosCustomerBillingAddresses(client: any, context: PointOfSaleContext, customerId: string): Promise<PosCustomerBillingAddress[]>;
export declare function getPosCustomerPurchaseHistory(client: any, context: PointOfSaleContext, customerId: string, input?: { cartId?: string | null; limit?: number; offset?: number }):
  Promise<{ rows: PosCustomerPurchase[]; total: number; limit: number; offset: number }>;
export declare function setPosCartBillingAddress(client: any, context: PointOfSaleContext, cartId: string, input: { billingAddressId: string; expectedVersion?: number; idempotencyKey?: string }):
  Promise<PosCart & { customerChanges: Array<{ code: string; message: string }> }>;

// F277 Cart. Field names are snake_case throughout -- getPosCart/reprice
// return the raw tenant.pos_carts/pos_cart_lines row shape directly
// (the same convention completePointOfSale/createPosReturn
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
  manual_discount_type?: "percent" | "amount" | null;
  manual_discount_value?: string | null;
  manual_discount_reason_code?: string | null;
  manual_discount_note?: string | null;
  cart_discount_amount?: string;
  cart_discount_excluded_reason?: string | null;
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
  // Joined in from tenant.items: "unlisted" on an open item (a typed name, price, HSN/SAC and GST; Create-Where-You-Are).
  system_role?: string | null;
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
  cart_discount_reason_code?: string | null;
  cart_discount_note?: string | null;
  cart_discount_total?: string;
  cart_discount_eligible_base?: string | null;
  cart_discount_approval_id?: string | null;
  cart_discount_issue_code?: string | null;
  cart_discount_issue_message?: string | null;
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
  customer: {
    id: string; code: string | null; name: string | null; legalName: string | null; type: "individual" | "business"; status: "active" | "inactive" | "blocked"; gstRegistered: boolean;
    gstin: string | null; phone: string | null; billingAddressId: string | null; billingAddresses: PosCustomerBillingAddress[];
    priceList: { id: string; name: string; isCustomerList: boolean } | null;
  } | null;
  buyerDetails: { name: string | null; address: { line1?: string; line2?: string; city?: string; stateCode?: string; postalCode?: string } } | null;
  receiptContact: { phone: string | null; email: string | null; consent: boolean; masked: boolean };
  policy: { allowWalkIn: boolean; allowBuyerName: boolean; allowReceiptContact: boolean; buyerDetailsRequiredAbove: string | null };
  buyerDetailsRequired: boolean; buyerDetailsComplete: boolean;
};
export declare const POS_CUSTOMER_MESSAGES: Readonly<Record<string, string>>;
export declare function getPosCustomerContext(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCustomerContext>;
export declare function setWalkInCustomer(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function selectPosCustomer(client: any, context: PointOfSaleContext, cartId: string, input: { customerId: string; billingAddressId?: string | null; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
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
  walkInByPaymentMethod: Array<{ method: string; transactions: number; amount: string }>; note: string;
  namedCustomers: { customers: number; repeatCustomers: number; top: Array<{ id: string; name: string | null; code: string | null; transactions: number; net: string }> } }>;
export declare function quickCreatePosCustomer(client: any, context: PointOfSaleContext, input: {
  kind?: "individual" | "business"; name: string; legalName?: string | null; phone?: string | null; email?: string | null; gstin?: string | null;
  billingAddress?: { line1?: string | null; line2?: string | null; city?: string | null; stateCode?: string | null; postalCode?: string | null } | null;
  contactPerson?: string | null; notes?: string | null; cartId?: string | null; idempotencyKey?: string; confirmNotDuplicate?: boolean; duplicateReason?: string | null;
}): Promise<{ customer: PointOfSaleCustomerMatch; created: boolean; warnings: string[] }>;
export declare function addPosCartLine(client: any, context: PointOfSaleContext, cartId: string, input: Record<string, any>): Promise<PosCart>;
export declare function getPosOpenItemOptions(client: any, context: PointOfSaleContext): Promise<{ allowed: boolean; taxCategories: Array<{ id: string; code: string; name: string }> }>;
export declare function addProductToPosCart(client: any, context: PointOfSaleContext, cartId: string, input: Record<string, any>): Promise<PosCart & { replayed?: boolean }>;
export declare function updatePosCartLineQuantity(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { quantity: number | string; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function removePosCartLine(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function setPosCartLineTracking(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { batchId?: string | null; serialId?: string | null; serialNumber?: string | null; batchNumber?: string | null; expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
// Manual discounts are authorized by the cashier's permission profile; above its limits, pass the approvalId of a supervisor approval.
export declare function applyPosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { type: "percent" | "amount"; value: number | string;
  reasonCode?: string | null; note?: string | null; reason?: string | null; expectedVersion?: number; approvalId?: string; idempotencyKey?: string }): Promise<PosCart>;
export declare function removePosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare function setPosCartDiscount(client: any, context: PointOfSaleContext, cartId: string, input: { type?: "percent" | "amount" | "percentage" | "fixed" | "PERCENTAGE" | "FIXED_AMOUNT" | null; value?: string | number;
  reasonCode?: string | null; note?: string | null; reason?: string; expectedVersion?: number; approvalId?: string; idempotencyKey?: string }): Promise<PosCart>;
export declare function removePosCartDiscount(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export declare const POS_CART_DISCOUNT_MESSAGES: Readonly<Record<string, string>>;
export declare const POS_CART_DISCOUNT_EXCLUSIONS: Readonly<Record<string, string>>;
export type PosCartDiscountExclusion = { lineNumber: number; lineId: string | null; description: string; reason: string; message: string; value: string };
export type PosCartDiscountBill = { subtotal: string; itemDiscounts: string; promotions: string; coupons: string; cartDiscount: string; taxable: string; tax: string; rounding: string; total: string };
export type PosCartDiscountPreview = {
  status: "ALLOWED" | "REQUIRES_APPROVAL" | "DENIED" | "INVALID"; issues: PosDiscountIssue[]; cartVersion: number; reasonRequired?: boolean; currency?: string;
  authority?: { percentage: string; amount: string; aggregateAmount: string; limit: string | null; message: string | null;
    approval: { permission: string; amount: string; percentage: string; resource: { type: string; id: string }; action: Record<string, unknown> } | null } | null;
  discount?: { type: "percent" | "amount" | null; value: string | null; eligibleBase: string; excludedBase: string; amount: string; fingerprint: string | null; excluded: PosCartDiscountExclusion[] };
  lines?: Array<{ lineId: string | null; description: string; grossAmount: string; itemDiscountAmount: string; promotionAmount: string; eligibleBase: string; cartDiscountAmount: string;
    excludedReason: string | null; taxableAmount: string; taxAmount: string; lineTotal: string; taxRate: string }>;
  before?: PosCartDiscountBill; after?: PosCartDiscountBill;
};
export declare function previewPosCartDiscount(client: any, context: PointOfSaleContext, cartId: string, input: { type: string; value: string }): Promise<PosCartDiscountPreview>;
export type PosCartDiscountEligibility = {
  cartVersion: number; currency: string; reasons: PosDiscountReason[]; reasonRequired: boolean; allowFullDiscount: boolean; allowZeroTotal: boolean; stacking: string; maxCartPercent: number | null;
  current: { type: "percent" | "amount"; value: string; amount: string; eligibleBase: string | null; reasonCode: string | null; note: string | null; approved: boolean;
    issue: { code: string; message: string } | null } | null;
  history: Array<{ id: string; status: string; type: string; value: string; amount: string; eligible_base: string; reason_code: string | null; note: string | null; approval_id: string | null;
    created_at: string; ended_at: string | null; created_by_name: string | null }>;
  eligibleBase: string; excludedBase: string; excluded: PosCartDiscountExclusion[]; lineCount: number; discountable: boolean;
  authority: { canDiscount: boolean; denied: string | null; mode: string | null; maxPercentage: number | null; maxAmount: number | null; maxAggregateAmount: number | null;
    usedOnSale: string; remainingOnSale: string | null };
};
export declare function getPosCartDiscountEligibility(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCartDiscountEligibility>;
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
  request_type: "auto" | "manual" | "reprint" | "test";
  status: string;
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
// POS Receipt Printing (0096): finalized document snapshots, server-rendered receipts, print jobs and printers.
export type PosDocumentSourceType = "pos_sale" | "pos_return";
export type PosReceiptWidth = 58 | 80 | 210;
export declare const POS_RECEIPT_MESSAGES: Readonly<Record<string, string>>;
export type PosDocumentSnapshot = {
  id: string; organization_id: string; store_id: string; source_type: PosDocumentSourceType; source_id: string; document_type: string; document_number: string;
  document_version: number; lookup_reference: string; issued_at: string; timezone: string; content: Record<string, any>; content_hash: string; status: string;
};
export type PosReceiptReprintReason = "customer_request" | "receipt_lost" | "printer_failed" | "receipt_damaged" | "finance_verification" | "audit_request" | "other";
export type PosReceiptLifecycle = { documentStatus: string; sourceStatus: string | null; warnings: { code: string; message: string }[] };
export type PosReceiptPrintJob = {
  terminalId: string | null; documentId: string | null; reasonCode: PosReceiptReprintReason | null; reasonNote: string | null; originalPrintJobId: string | null;
  originalDocumentPreserved: true; terminalCode?: string | null; reasonLabel?: string | null;
  attemptHistory?: { attempt: number; adapter: string; status: string; errorCode: string | null; confirmedNotPrinted: boolean; startedAt: string; completedAt: string | null }[];
  id: string; status: "QUEUED" | "RENDERING" | "READY" | "DISPATCHED" | "ACKNOWLEDGED" | "FAILED" | "OUTCOME_UNKNOWN" | "CANCELLED";
  requestType: "auto" | "manual" | "reprint" | "test"; copyLabel: "original" | "copy" | "merchant_copy" | "test"; paperWidthMm: PosReceiptWidth; attempts: number;
  lastErrorCode: string | null; printerId: string | null; documentNumber: string | null; documentVersion: number | null; createdAt: string; dispatchedAt: string | null;
  resolvedAt: string | null; message: string | null; requestedBy?: string | null; printerName?: string;
};
export type PosReceiptPrinter = {
  id: string; storeId: string; terminalId: string; name: string; connectionMode: "browser" | "print_agent" | "network_bridge"; profile: "thermal_generic" | "escpos" | "a4_document";
  paperWidthMm: PosReceiptWidth; isDefault: boolean; autoPrint: boolean; copies: number; merchantCopy: boolean; cutPaper: boolean; encoding: string;
  bridgeDeviceReference: string | null; enabled: boolean; version: number; connectionStatus: "browser" | "unknown";
};
export type PosReceiptPrintResult = { job: PosReceiptPrintJob | null; html: string | null; replayed?: boolean; skipped?: string; fallback?: "browser" | null; lifecycle?: PosReceiptLifecycle };
export type PosReceiptDocumentSummary = { id: string; type: string; number: string; version: number; issuedAt: string; lookupReference: string; hash: string; status: string;
  sourceType: PosDocumentSourceType; sourceId: string; provenance: "issued" | "sale_record" };
export declare const POS_RECEIPT_REPRINT_REASONS: Readonly<Record<PosReceiptReprintReason, string>>;
export declare function issuePosDocument(client: any, context: PointOfSaleContext, sourceType: PosDocumentSourceType, sourceId: string): Promise<void>;
export type PosReceiptReprintEligibility = {
  document: PosReceiptDocumentSummary; lifecycle: PosReceiptLifecycle; timesPrinted: number; nextPrint: "original" | "copy"; canPrintOriginal: boolean; canReprint: boolean;
  reasonRequired: boolean; reasons: { code: PosReceiptReprintReason; label: string }[]; printers: PosReceiptPrinter[]; defaultPrinterId: string | null;
};
export declare function getPosReceiptReprintEligibility(client: any, context: PointOfSaleContext, sourceType: PosDocumentSourceType, sourceId: string, input?: { terminalId?: string }): Promise<PosReceiptReprintEligibility>;
export type PosReprintSummary = {
  from: string; to: string; totals: { reprints: number; documents: number; failed: number; unknown: number; dispatched: number };
  byUser: { name: string; reprints: number }[]; byReason: { reason: string; label: string; reprints: number }[];
  frequent: { number: string; source_type: PosDocumentSourceType; source_id: string; reprints: number }[];
};
export declare function getPosReprintSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string }): Promise<PosReprintSummary>;
export declare function resolvePosDocument(client: any, context: PointOfSaleContext, sourceType: PosDocumentSourceType, sourceId: string, options?: { version?: number; atCompletion?: boolean }): Promise<PosDocumentSnapshot>;
export declare function renderReceiptHtml(document: PosDocumentSnapshot, options?: { width?: PosReceiptWidth; copies?: string[]; reprintedAt?: string | Date | null }): string;
export declare function code128Svg(text: string, options?: { height?: number; module?: number }): string;
export declare function previewPosReceipt(client: any, context: PointOfSaleContext, sourceType: PosDocumentSourceType, sourceId: string, input?: { width?: number; version?: number; asCopy?: boolean }): Promise<{
  document: PosReceiptDocumentSummary; lifecycle: PosReceiptLifecycle; width: PosReceiptWidth; html: string;
}>;
export declare function createPosReceiptPrintJob(client: any, context: PointOfSaleContext, sourceType: PosDocumentSourceType, sourceId: string, input?: {
  printerId?: string; terminalId?: string; width?: number; requestType?: "auto" | "manual" | "reprint"; idempotencyKey?: string; documentVersion?: number;
  reasonCode?: PosReceiptReprintReason; reasonNote?: string;
}): Promise<PosReceiptPrintResult>;
export declare function reportPosReceiptPrintJob(client: any, context: PointOfSaleContext, jobId: string, input: { outcome: "dialog_opened" | "cancelled" | "failed" | "unknown"; errorCode?: string }): Promise<PosReceiptPrintJob>;
export declare function retryPosReceiptPrintJob(client: any, context: PointOfSaleContext, jobId: string, input?: { confirmNotPrinted?: boolean; expectedDocumentVersion?: number }): Promise<{ job: PosReceiptPrintJob; html: string }>;
export declare function getPosReceiptPrintJob(client: any, context: PointOfSaleContext, jobId: string): Promise<PosReceiptPrintJob>;
export declare function listPosReceiptPrintHistory(client: any, context: PointOfSaleContext, sourceType: PosDocumentSourceType, sourceId: string): Promise<{
  document: { id: string; number: string; type: string; version: number; lookupReference: string }; jobs: PosReceiptPrintJob[];
}>;
export declare function resolvePosReceiptFromCode(client: any, context: PointOfSaleContext, code: string): Promise<{ sourceType: PosDocumentSourceType; sourceId: string; saleId: string | null; documentNumber: string; documentType: string }>;
export declare function listPosReceiptPrinters(client: any, context: PointOfSaleContext, input?: { terminalId?: string }): Promise<PosReceiptPrinter[]>;
export declare function savePosReceiptPrinter(client: any, context: PointOfSaleContext, input: Partial<Omit<PosReceiptPrinter, "storeId" | "version" | "connectionStatus">> & { expectedVersion?: number }): Promise<PosReceiptPrinter>;
export declare function testPosReceiptPrinter(client: any, context: PointOfSaleContext, printerId: string): Promise<{ job: PosReceiptPrintJob; html: string }>;
export type PosReceiptBranding = { storeId: string; name: string; receiptMessage: string | null; returnPolicy: string | null; supportText: string | null; referenceCodeEnabled: boolean };
export declare function getPosReceiptBranding(client: any, context: PointOfSaleContext, storeId: string): Promise<PosReceiptBranding>;
export declare function updatePosReceiptBranding(client: any, context: PointOfSaleContext, storeId: string, input: {
  receiptMessage?: string | null; returnPolicy?: string | null; supportText?: string | null; referenceCodeEnabled?: boolean;
}): Promise<PosReceiptBranding>;

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
  amount?: string;
  customer?: string;
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
    payments: Array<{ method: "cash"; amount: number } | { method: "cash"; paymentId: string } | { method: "card" | "upi" | "wallet" | "bank_transfer"; paymentId: string }>;
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
// POS Cash Payments (0092).
export declare const POS_CASH_MESSAGES: Readonly<Record<string, string>>;
export declare function suggestCashTenderAmounts(due: string | number, denominations?: number[]): string[];
export type PosCashTender = {
  id: string; status: "COMPLETED" | "CASH_RECEIVED_PENDING_FINALIZATION" | "CANCELLED_RETURNED" | "RECONCILIATION_REQUIRED" | string;
  cashReceivedAmount: string | null; amountApplied: string; changeGivenAmount: string | null; retainedAmount: string | null; shiftId: string; terminalId: string | null;
  saleId: string | null; confirmedAt: string | null; completedAt: string | null; finalizationError: string | null; note: string | null;
};
export type PosCheckoutPaymentMethods = {
  cartId: string; cartVersion: number; currency: string; grandTotal: string; amountDue: string; paidNonCash: string;
  methods: Array<{ method: "cash" | "upi" | "card"; enabled: boolean; reason: string | null }>;
  cash: { enabled: boolean; quickAmounts: string[]; maxTender: string | null; warnAbove: string | null; drawerConfigured: boolean; pending: PosCashTender | null };
};
export type PosCashPreview = {
  status: "SUFFICIENT" | "INSUFFICIENT" | "INVALID"; issues: Array<{ code: string; message: string }>; warnings?: Array<{ code: string; message: string }>; currency: string;
  amountDue: string; cashReceivedAmount?: string; amountApplied?: string; changeDueAmount?: string; remainingAmount?: string; netCashRetained?: string; splitAvailable?: boolean;
};
export type PosCashOutcome = {
  status: string; paymentMethod: "CASH"; currency: string; payment: PosCashTender; cashReceivedAmount: string | null; amountApplied: string; changeGivenAmount: string | null;
  remainingAmount: string; saleStatus: "COMPLETED" | "NOT_FINALIZED"; sale: PosSale | null; saleId: string | null; receiptAvailable: boolean;
  error: { code: string; cause: string; message: string } | null; recovery: string[] | null; drawer: { configured: boolean; command: string | null; message: string } | null; replayed?: boolean;
};
export type PosCheckoutPayments = {
  cartId: string; status: string; cartVersion: number; currency: string; grandTotal: string; paidNonCash: string; cashHeld: string; amountDue: string; saleId: string | null;
  payments: Array<{ id: string; method: string; status: string; amount: string; saleId: string | null; cash: PosCashTender | null }>; pendingCash: PosCashTender | null;
};
export declare function getPosCheckoutPaymentMethods(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCheckoutPaymentMethods>;
export declare function previewPosCashPayment(client: any, context: PointOfSaleContext, cartId: string, input: { cashReceived: string; currency?: string }): Promise<PosCashPreview>;
export declare function confirmPosCashPayment(client: any, context: PointOfSaleContext, cartId: string, input: { cashReceived: string; changeGiven?: string | null; currency?: string;
  split?: boolean; complete?: boolean; expectedVersion?: number; idempotencyKey: string }): Promise<PosCashOutcome>;
export declare function finalizePosCashPayment(client: any, context: PointOfSaleContext, cartId: string, input?: { idempotencyKey?: string }): Promise<PosCashOutcome>;
export declare function returnPosCashTender(client: any, context: PointOfSaleContext, cartId: string, input: { reason?: string; cashReturned: boolean; returnedAmount?: string | null;
  idempotencyKey: string }): Promise<PosCashOutcome>;
export declare function flagPosCashTenderForReconciliation(client: any, context: PointOfSaleContext, cartId: string, input: { note: string }): Promise<PosCashOutcome>;
export declare function resolvePosCashReconciliation(client: any, context: PointOfSaleContext, cartId: string, input: { resolution: "complete" | "return"; note?: string;
  reason?: string; idempotencyKey?: string }): Promise<PosCashOutcome>;
export declare function getPosCheckoutPayments(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCheckoutPayments>;
export declare function getPosPaymentDetail(client: any, context: PointOfSaleContext, paymentId: string): Promise<{ id: string; method: string; status: string; amount: string; currency: string;
  saleId: string | null; cartId: string | null; shiftId: string; cash: PosCashTender | null; movements: Array<{ id: string; movement_number: string; cash_event: string; amount: string; reason: string | null; created_at: string; shift_id: string }> }>;
export type PosSessionCash = {
  shiftId: string; status: string;
  summary: { received: string; change: string; salesNet: string; returned: string; refunds: string; pendingCustody: string; pendingCount: number; expected: string | null };
  payments: Array<PosCashTender & { receiptNumber: string | null; cartId: string | null }>;
  movements: Array<{ id: string; movement_number: string; movement_type: string; cash_event: string | null; amount: string; reason: string | null; payment_id: string | null; created_at: string }>;
};
export declare function listPosSessionCashPayments(client: any, context: PointOfSaleContext, shiftId: string): Promise<PosSessionCash>;
export type PosCashPaymentSummary = {
  from: string; to: string;
  totals: { cash_sales: string; cash_sale_count: number; received: string; change: string; all_payments: string; split_cash: string; pending_custody: string; returned_count: number;
    returned: string; net: string; refunds: string; cash_share_percent: string; shortages: string; excesses: string; sessions_with_variance: number };
  byOutlet: Array<{ name: string; sales: number; cash: string; received: string; change: string }>;
  byTerminal: Array<{ name: string; sales: number; cash: string; received: string; change: string }>;
  byCashier: Array<{ name: string; sales: number; cash: string; received: string; change: string }>;
  bySession: Array<{ name: string; sales: number; cash: string; received: string; change: string }>;
};
export declare function getPosCashPaymentSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string; storeId?: string }): Promise<PosCashPaymentSummary>;
// POS Card Payments (0093).
export declare const POS_CARD_MESSAGES: Readonly<Record<string, string>>;
export type PosPaymentTerminal = { id: string; name: string; storeId: string; providerKey: string; merchantAccountReference: string | null; providerTerminalReference: string;
  integrationMode: "integrated" | "standalone"; status: "active" | "disabled"; connectionStatus: string; busy: boolean; activePaymentId: string | null; version: number };
export type PosCardAttempt = {
  attemptId: string; paymentId: string; method: string; status: string; verificationStatus: string | null; amount: string; currency: string; providerReference: string | null;
  externalReference: string | null; terminalId: string | null; terminalLabel: string | null; card: { network: string | null; type: string | null; masked: string | null } | null;
  message: string | null; saleId: string | null; recoveryStatus: string | null; refundedAmount: string; createdAt: string; resolvedAt: string | null;
  checkoutStatus?: "COMPLETED" | "CHECKOUT_PENDING" | "OPEN"; receiptAvailable?: boolean; remainingAmount?: string | null;
  finalizationError?: { code: string; cause: string; message: string } | null; recovery?: string[] | null; provisional?: boolean; note?: string; replayed?: boolean;
};
export type PosCardRefund = { id: string; paymentId: string; returnId: string | null; status: string; amount: string; currency: string; providerRefundReference: string | null;
  failureMessage: string | null; createdAt: string; resolvedAt: string | null };
export type PosCheckoutCardOptions = { enabled: boolean; integratedReady: boolean; standaloneEnabled: boolean; provisionalAcceptance: boolean; standaloneApprovalAbove: string | null;
  amountDue: string; currency: string; terminals: PosPaymentTerminal[]; attempt: PosCardAttempt | null };
export declare function listPosPaymentTerminals(client: any, context: PointOfSaleContext, input?: { storeId?: string }): Promise<PosPaymentTerminal[]>;
export declare function savePosPaymentTerminal(client: any, context: PointOfSaleContext, input: { id?: string; storeId?: string; name: string; providerKey?: string;
  providerTerminalReference: string; merchantAccountReference?: string | null; integrationMode?: "integrated" | "standalone"; status?: "active" | "disabled"; expectedVersion?: number }): Promise<PosPaymentTerminal>;
export declare function startPosCardPayment(client: any, context: PointOfSaleContext, cartId: string, input: { terminalId: string; amount?: string | null; expectedVersion?: number;
  idempotencyKey: string; outcome?: string }): Promise<PosCardAttempt>;
export declare function getPosCardAttempt(client: any, context: PointOfSaleContext, attemptId: string, options?: { refresh?: boolean }): Promise<PosCardAttempt>;
export declare function cancelPosCardAttempt(client: any, context: PointOfSaleContext, attemptId: string, input?: { reason?: string }): Promise<PosCardAttempt>;
export declare function recordStandaloneCardPayment(client: any, context: PointOfSaleContext, cartId: string, input: { terminalId: string; amount?: string | null; reference: string;
  attested: boolean; cardLastFour?: string | null; cardNetwork?: string | null; approvalId?: string; idempotencyKey: string }): Promise<PosCardAttempt>;
export declare function finalizePosCardCheckout(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCardAttempt>;
export declare function refundPosCardPayment(client: any, context: PointOfSaleContext, paymentId: string, input: { amount: string; reason?: string; returnId?: string; approvalId?: string;
  idempotencyKey: string; outcome?: string }): Promise<{ refund: PosCardRefund; replayed: boolean }>;
export declare function getPosCardRefund(client: any, context: PointOfSaleContext, refundId: string): Promise<PosCardRefund>;
export declare function refundUnfinalizedCardPayment(client: any, context: PointOfSaleContext, attemptId: string, input: { reason?: string; idempotencyKey: string; approvalId?: string;
  outcome?: string }): Promise<PosCardAttempt & { refund: PosCardRefund }>;
export declare function getPosCheckoutCardOptions(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCheckoutCardOptions>;
export type PosCardPaymentSummary = {
  from: string; to: string;
  totals: { card_sales: number; card_amount: string; provider_verified: string; externally_attested: string; declined: number; failed: number; unresolved: number; cancelled: number;
    captured_not_finalized: number; refunded: string; settled_gross: string; fees: string; unsettled: string; fee_tax: string; net: string; unmatched: number; mismatched: number; duplicates: number };
  byOutlet: Array<{ name: string; sales: number; amount: string; declined: number }>;
  byTerminal: Array<{ name: string; sales: number; amount: string; declined: number }>;
  byCashier: Array<{ name: string; sales: number; amount: string; declined: number }>;
};
export declare function getPosCardPaymentSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string; storeId?: string }): Promise<PosCardPaymentSummary>;
export type PosCardConfig = {
  storeId: string; storeName: string; configured: boolean; providerKey: string | null; active: boolean; merchantAccountReference: string | null;
  integrationMode: "integrated" | "standalone" | "both"; standaloneEnabled: boolean; provisionalAcceptance: boolean; standaloneApprovalAbove: string | null; refundEnabled: boolean;
  settlementSource: "provider_api" | "import"; configurationStatus: "ready" | "incomplete" | "disabled"; supportedCurrency: string; maxAmount: string | null; credentialReference: string | null;
  terminals: PosPaymentTerminal[];
};
export declare function listPosCardConfigs(client: any, context: PointOfSaleContext): Promise<PosCardConfig[]>;
export declare function updatePosCardConfig(client: any, context: PointOfSaleContext, storeId: string, input: Partial<{
  providerKey: string; active: boolean; merchantAccountReference: string | null; integrationMode: "integrated" | "standalone" | "both"; standaloneEnabled: boolean;
  provisionalAcceptance: boolean; standaloneApprovalAbove: string | number | null; refundEnabled: boolean; settlementSource: "provider_api" | "import";
  configurationStatus: "ready" | "incomplete" | "disabled"; maxAmount: string | number | null; credentialReference: string | null }>): Promise<PosCardConfig>;
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
// POS Taxes (migration 0089).
export declare const POS_TAX_MESSAGES: Readonly<Record<string, string>>;
export type PosTaxComponent = { type: string; label: string; rate: string; taxableAmount?: string; taxAmount: string };
export type PosCartTaxes =
  | { status: "EMPTY"; cartVersion: number; lines: []; breakdown: []; taxTotal: string; taxableTotal: string; grandTotal: string }
  | { status: "INVALID"; cartVersion: number; code: string; message: string }
  | {
    status: "VALID"; cartVersion: number; currency: string; stale: boolean; seller: { name: string; gstin: string | null; stateCode: string | null; stateName: string | null } | null;
    taxEnabled: boolean; taxDate: string; supplyMode: "in_store" | "delivery"; deliveryStateCode: string | null; placeOfSupply: string | null; placeOfSupplyName: string | null;
    documentType: "tax_invoice" | "bill_of_supply" | "invoice_cum_bill_of_supply"; pricesIncludeTax: boolean | null; taxableTotal: string; taxTotal: string; roundingAdjustment: string;
    grandTotal: string; breakdown: PosTaxComponent[];
    lines: Array<{ lineId: string | null; description: string; hsnSac: string | null; classification: string; rate: string; priceIncludesTax: boolean; taxableAmount: string; taxAmount: string;
      components: PosTaxComponent[] }>;
  };
export declare function getPosCartTaxes(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCartTaxes>;
export declare function setPosCartSupply(client: any, context: PointOfSaleContext, cartId: string, input: { supplyMode: "in_store" | "delivery"; deliveryStateCode?: string | null;
  expectedVersion?: number; idempotencyKey?: string }): Promise<PosCart>;
export type PosSaleTaxes = {
  saleId: string; receiptNumber: string; currency: string; taxDate: string | null; documentType: string | null;
  seller: { name: string; legalName?: string | null; gstin: string | null; stateCode: string | null; stateName: string | null; address?: string | null } | null;
  placeOfSupply: string | null; supplyMode: string | null; buyer: { mode: string; treatment: string | null; gstin: string | null };
  taxableTotal: string | null; taxTotal: string; roundingAdjustment: string; grandTotal: string; breakdown: PosTaxComponent[];
  lines: Array<{ id: string; lineNumber: number; description: string; quantity: string; hsnSac: string | null; classification: string | null; rate: string | null; priceIncludesTax: boolean | null;
    taxableAmount: string | null; taxAmount: string; lineTotal: string; components: PosTaxComponent[]; placeOfSupply: string | null }>;
  reversedByReturns: { taxableAmount: string; taxAmount: string };
};
export declare function getPosSaleTaxes(client: any, context: PointOfSaleContext, saleId: string): Promise<PosSaleTaxes>;
export type PosTaxSummary = {
  from: string; to: string; currency: string; totals: { sales: number; taxable: string; tax: string; gross: string };
  byComponent: Array<{ type: string; rate: string; taxable: string; tax: string }>;
  byClassification: Array<{ classification: string; rate: string; lines: number; taxable: string; tax: string }>;
  byHsn: Array<{ hsn: string; quantity: string; taxable: string; tax: string }>;
  byOutlet: Array<{ code: string; name: string; gstin: string; sales: number; taxable: string; tax: string }>;
  byBuyer: Array<{ treatment: string; mode: string; sales: number; taxable: string; tax: string }>;
  returns: { returns: number; taxable: string; tax: string; refunded: string; byComponent: Array<{ type: string; rate: string; tax: string }> };
  reconciliation: { sales_not_matching_lines: number; lines_not_matching_components: number; ok: boolean };
};
export declare function getPosTaxSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string; storeId?: string }): Promise<PosTaxSummary>;
// Item Discounts (migration 0090).
export declare const POS_ITEM_DISCOUNT_MESSAGES: Readonly<Record<string, string>>;
export type PosDiscountIssue = { code: string; message: string; lineNumber?: number };
export type PosLineDiscountPreview = {
  status: "ALLOWED" | "REQUIRES_APPROVAL" | "DENIED" | "INVALID"; issues: PosDiscountIssue[]; cartVersion?: number; reasonRequired?: boolean;
  authority: { percentage: string; amount: string; aggregateAmount: string; limit: string | null; message: string | null;
    approval: { permission: string; amount: string; percentage: string; resource: { type: string; id: string }; action: Record<string, unknown> } | null } | null;
  line?: { lineId: string; description: string; quantity: string; unitPrice: string; grossAmount: string; promotionAmount: string; manualDiscountAmount: string; cartDiscountAmount: string;
    taxableAmount: string; taxAmount: string; lineTotal: string; priceIncludesTax: boolean };
  bill?: { totalBefore: string; totalAfter: string; taxBefore: string; taxAfter: string };
};
export declare function previewPosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { type: "percent" | "amount"; value: string }): Promise<PosLineDiscountPreview>;
export type PosDiscountReason = { code: string; label: string; requiresNote?: boolean };
export type PosLineDiscountEligibility = {
  lineId: string; cartVersion: number; discountable: boolean; blockedBy: string | null; maxPercent: number | null; minSellingPrice: number | null;
  stacking: string; allowFullDiscount: boolean; line: { grossAmount: string; promotionAmount: string; unitPrice: string; quantity: string; priceIncludesTax: boolean };
  current: { type: "percent" | "amount"; value: string; amount: string; reasonCode: string | null; note: string | null; approved: boolean } | null;
  reasons: PosDiscountReason[]; reasonRequired: boolean;
  authority: { canDiscount: boolean; denied: string | null; mode: string | null; maxPercentage: number | null; maxAmount: number | null; maxAggregateAmount: number | null;
    usedOnSale: string; remainingOnSale: string | null };
};
export declare function getPosCartLineDiscountEligibility(client: any, context: PointOfSaleContext, cartId: string, lineId: string): Promise<PosLineDiscountEligibility>;
export declare function listPosCartDiscounts(client: any, context: PointOfSaleContext, cartId: string): Promise<{ cartVersion: number; totals: { promotion: string; manual: string; cart: string };
  lines: Array<{ lineId: string; description: string; grossAmount: string; promotionAmount: string; cartDiscountAmount: string; taxableAmount: string; lineTotal: string; issues: PosDiscountIssue[];
    manual: { type: string; value: string; amount: string; reasonCode: string | null; approved: boolean } | null }> }>;
export type PosDiscountSummary = {
  from: string; to: string; currency: string;
  totals: { automatic: string; manual: string; cart: string; coupon: string; discounted_sales: number; discounted_lines: number; manual_lines: number; approved_lines: number;
    approved_amount: string; returned: string; net: string };
  byOutlet: Array<{ code: string; name: string; automatic: string; manual: string; cart: string; coupon: string }>;
  byItem: Array<{ code: string; name: string; manual_lines: number; automatic: string; manual: string; cart: string; coupon: string }>;
  byReason: Array<{ reason: string; lines: number; manual: string }>;
  byCustomer: Array<{ id: string; name: string | null; automatic: string; manual: string; cart: string; coupon: string }>;
  byCashier: Array<{ name: string; manual_lines: number; manual: string; approved_lines: number }> | null;
  cart: {
    totals: { sales: number; amount: string; average: string; approved_sales: number; approved_amount: string; returned: string; net: string; manual_exposure: string };
    byReason: Array<{ reason: string; sales: number; amount: string }>;
    byDate: Array<{ date: string; sales: number; amount: string }>;
    byCashier: Array<{ name: string; sales: number; amount: string; approved_sales: number }> | null;
  };
};
export declare function getPosDiscountSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string; storeId?: string }): Promise<PosDiscountSummary>;
// POS UPI & Digital Payments (0094).
export declare const POS_UPI_MESSAGES: Readonly<Record<string, string>>;
export type PosDigitalAttempt = PosCardAttempt & {
  mode?: string | null; instrument?: string | null; transactionReference?: string | null; receivedAmount?: string | null;
  qr?: { payload: string | null; imageUrl: string | null } | null; paymentLinkUrl?: string | null; requestReference?: string | null; expiresAt?: string | null;
  requestStatus?: string | null; merchantName?: string | null;
};
export type PosCheckoutUpiOptions = {
  enabled: boolean; currency: string; amountDue: string; merchantName: string | null;
  modes: { dynamicQr: boolean; paymentLink: boolean; upiIntent: boolean; staticQr: boolean };
  staticQr: { vpa: string; payload: string; provisionalAcceptance: boolean } | null; attempt: PosDigitalAttempt | null;
};
export declare function getPosCheckoutUpiOptions(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCheckoutUpiOptions>;
export declare function startPosUpiPayment(client: any, context: PointOfSaleContext, cartId: string, input: { mode?: "dynamic_qr" | "payment_link" | "upi_intent";
  method?: "upi" | "wallet" | "bank_transfer"; amount?: string | null; contact?: string | null; consent?: boolean; expectedVersion?: number; idempotencyKey: string; outcome?: string }): Promise<PosDigitalAttempt>;
export declare function recordStaticUpiPayment(client: any, context: PointOfSaleContext, cartId: string, input: { utr: string; amount?: string | null; attested: boolean;
  approvalId?: string; idempotencyKey: string }): Promise<PosDigitalAttempt>;
export type PosUpiConfig = {
  storeId: string; storeName: string; configured: boolean; providerKey: string | null; merchantDisplayName: string | null; merchantAccountReference: string | null;
  configurationStatus: "ready" | "incomplete" | "disabled"; staticQrVpa: string | null; staticQrVerifiedAt: string | null; staticQrEnabled: boolean; provisionalAcceptance: boolean;
  approvalAbove: string | null; paymentLinksEnabled: boolean; intentEnabled: boolean; digitalMethods: string[]; qrValiditySeconds: number; refundEnabled: boolean; maxAmount: string | null;
  credentialReference: string | null;
};
export declare function listPosUpiConfigs(client: any, context: PointOfSaleContext): Promise<PosUpiConfig[]>;
export declare function updatePosUpiConfig(client: any, context: PointOfSaleContext, storeId: string, input: Partial<{
  providerKey: string; merchantDisplayName: string | null; merchantAccountReference: string | null; configurationStatus: "ready" | "incomplete" | "disabled";
  staticQrVpa: string | null; verifyStaticQr: boolean; staticQrEnabled: boolean; provisionalAcceptance: boolean; approvalAbove: string | number | null; paymentLinksEnabled: boolean;
  intentEnabled: boolean; digitalMethods: string[]; qrValiditySeconds: number; refundEnabled: boolean; maxAmount: string | number | null; credentialReference: string | null }>): Promise<PosUpiConfig>;
export type PosPaymentException = {
  id: string; type: string; status: string; amount: string | null; expectedAmount: string | null; currency: string | null; providerKey: string; providerReference: string | null;
  transactionReference: string | null; detail: string | null; paymentId: string | null; cartId: string | null; resolutionNote: string | null; providerRefundReference: string | null;
  createdAt: string; resolvedAt: string | null;
};
export declare function listPosPaymentExceptions(client: any, context: PointOfSaleContext, input?: { status?: string }): Promise<PosPaymentException[]>;
export declare function resolvePosPaymentException(client: any, context: PointOfSaleContext, exceptionId: string, input: { action: "refund" | "resolve"; note: string }): Promise<PosPaymentException>;
export type PosDigitalPaymentSummary = {
  from: string; to: string;
  totals: { digital_sales: number; verified: string; attested: string; refunded: string; pending: number; expired_unresolved: number; failed: number; cancelled: number;
    reconciliation_required: number; settled_gross: string; fees: string; unsettled: string; net: string; digital_share_percent: string };
  byInstrument: Array<{ instrument: string; mode: string; payments: number; amount: string }>;
  byOutlet: Array<{ name: string; payments: number; amount: string }>;
  byCashier: Array<{ name: string; payments: number; amount: string }>;
  exceptions: Array<{ type: string; status: string; count: number; amount: string }>;
  openExceptionAmount: string;
};
export declare function getPosDigitalPaymentSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string; storeId?: string }): Promise<PosDigitalPaymentSummary>;
// POS Split Payments (0095).
export declare const POS_SPLIT_MESSAGES: Readonly<Record<string, string>>;
export type PosSplitComponent = {
  method: "cash" | "card" | "upi"; plannedAmount: string; appliedAmount: string;
  status: "PROPOSED" | "AWAITING_PAYMENT" | "PROCESSING" | "CONFIRMED" | "FAILED" | "UNKNOWN" | "CANCEL_PENDING" | "CANCELLED" | "REVERSAL_REQUIRED" | "REVERSED" | "RECONCILIATION_REQUIRED";
  paymentId: string | null; attemptStatus: string | null; cash: { received: string; change: string } | null; locked: boolean; sequence: number;
};
export type PosSplitStatus = {
  cartId: string; checkoutStatus: "DRAFT" | "CHECKOUT_PENDING" | "COMPLETED"; currency: string; payableAmount: string; confirmedAppliedAmount: string; remainingPayableAmount: string;
  unallocatedAmount: string; planVersion: number; paymentMode: "single" | "split"; splitEnabled: boolean; components: PosSplitComponent[];
  availableMethods: Record<"cash" | "card" | "upi", boolean>; nextMethod: string | null; activeMethod: string | null; saleId: string | null; canFinalize: boolean; replayed?: boolean;
};
export declare function getPosSplitPaymentStatus(client: any, context: PointOfSaleContext, cartId: string): Promise<PosSplitStatus>;
export declare function saveSplitPaymentPlan(client: any, context: PointOfSaleContext, cartId: string, input: { components: Array<{ method: string; amount: string }>;
  expectedPlanVersion?: number; idempotencyKey: string }): Promise<PosSplitStatus>;
export declare function initiateSplitComponent(client: any, context: PointOfSaleContext, cartId: string, input: { method: "cash" | "card" | "upi"; terminalId?: string;
  cashReceived?: string; changeGiven?: string | null; idempotencyKey: string; outcome?: string }): Promise<{ result: any; split: PosSplitStatus }>;
export declare function finalizeSplitCheckout(client: any, context: PointOfSaleContext, cartId: string): Promise<PosSplitStatus>;
export declare function cancelSplitCheckout(client: any, context: PointOfSaleContext, cartId: string, input?: { reason?: string; cashReturned?: boolean; approvalId?: string;
  idempotencyKey?: string }): Promise<{ status: "CANCELLED" | "CANCELLATION_PENDING"; code?: string; message?: string; actions: Array<{ method: string; action: string; status: string }>; split: PosSplitStatus }>;
export declare function previewPosReturnRefundAllocation(client: any, context: PointOfSaleContext, returnId: string): Promise<{ returnId: string; refundTotal: string; policy: string;
  allocations: Array<{ paymentId: string; method: string; applied: string; alreadyRefunded: string; refund: string; reference: string | null }> }>;
export type PosSplitPaymentSummary = { from: string; to: string; totals: { split_sales: number; all_sales: number; split_value: string; cancellations: number };
  byCombination: Array<{ combination: string; sales: number; value: string }>; byMethod: Array<{ method: string; amount: string }> };
export declare function getPosSplitPaymentSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string }): Promise<PosSplitPaymentSummary>;

// POS GST Invoice (0098): POS as a source of the shared invoicing — preview before payment, issue at completion, credit notes on returns.
export declare const POS_INVOICE_MESSAGES: Readonly<Record<string, string>>;
export type PosInvoiceIssue = { code: string; message: string };
export type PosInvoicePreview = {
  status: "VALID" | "INVALID"; checkoutReady: boolean; invoiceNumber: null; documentType?: "tax_invoice" | "bill_of_supply" | "invoice_cum_bill_of_supply" | "receipt"; statutory?: boolean;
  seller?: { legalName: string | null; gstin: string | null; stateCode: string | null; address: string | null } | null; customerMode?: "WALK_IN" | "REGISTERED";
  supplyType?: "B2B" | "B2C"; buyerGstin?: string | null; buyerGstinCheck?: { valid: boolean; message: string } | null;
  placeOfSupply?: { code: string; name: string | null } | null; reverseCharge?: boolean; currency?: string;
  lines?: Array<{ description: string; hsnSac: string | null; quantity: string; uom: string | null; taxableAmount: string | null; classification: string | null; rate: string | null;
    taxAmount: string | null; total: string | null }>;
  taxableAmount?: string | null; taxes?: Record<string, string>; discountTotal?: string | null; roundingAdjustment?: string | null; grandTotal?: string | null;
  einvoiceApplicability?: string; issues: PosInvoiceIssue[]; note?: string;
};
export type PosInvoiceLine = {
  lineNumber: number; description: string; hsnSac: string | null; uom: string | null; quantity: string; unitPrice: string | null; grossAmount: string | null; itemDiscount: string | null;
  promotionDiscount: string | null; cartDiscount: string | null; taxableAmount: string | null; classification: string | null; taxRate: string | null; cgst: string | null; sgst: string | null;
  utgst: string | null; igst: string | null; cess: string | null; total: string | null;
};
export type PosInvoice = {
  id: string; sourceType: "pos_sale" | "pos_return"; sourceId: string; storeId: string | null; documentType: string; invoiceNumber: string; financialYear: string; issuedAt: string;
  originalInvoiceId: string | null; originalInvoiceNumber: string | null; reason: string | null; customerMode: string; supplyType: "b2b" | "b2c"; buyerGstin: string | null;
  seller: Record<string, any>; buyer: Record<string, any>; placeOfSupply: string | null; reverseCharge: boolean; currency: string; subtotal: string | null; discountTotal: string | null;
  taxableTotal: string | null; cgst: string | null; sgst: string | null; utgst: string | null; igst: string | null; cess: string | null; taxTotal: string | null;
  roundingAdjustment: string | null; grandTotal: string | null; einvoiceStatus: string; irn: string | null; documentStatus: string; contentHash: string; storeName: string | null;
  saleId: string | null; receiptNumber: string | null; lines?: PosInvoiceLine[]; creditNotes?: Array<{ id: string; number: string; issuedAt: string; total: string | null }>;
};
export declare function invoiceCheckoutIssues(client: any, context: PointOfSaleContext, cart: Record<string, any>, priced: Record<string, any> | null): Promise<PosInvoiceIssue[]>;
export declare function previewPosCartInvoice(client: any, context: PointOfSaleContext, cartId: string): Promise<PosInvoicePreview>;
export declare function issuePosSaleInvoice(client: any, context: PointOfSaleContext, saleId: string): Promise<Record<string, any> | null>;
export declare function issuePosReturnCreditNote(client: any, context: PointOfSaleContext, returnId: string): Promise<Record<string, any> | null>;
export declare function getPosInvoice(client: any, context: PointOfSaleContext, invoiceId: string): Promise<PosInvoice>;
export declare function getPosSaleInvoice(client: any, context: PointOfSaleContext, saleId: string): Promise<{ invoice: PosInvoice | null; note: string | null }>;
export declare function listPosInvoices(client: any, context: PointOfSaleContext, options?: {
  search?: string; documentType?: string; supplyType?: "b2b" | "b2c"; dateFrom?: string; dateTo?: string; limit?: number; offset?: number;
}): Promise<{ rows: PosInvoice[]; total: number }>;
export declare function getPosInvoiceEInvoiceStatus(client: any, context: PointOfSaleContext, invoiceId: string): Promise<{ invoiceId: string; status: string; irn: string | null; providerAvailable: boolean; message: string }>;
export declare function reconcilePosInvoice(client: any, context: PointOfSaleContext, invoiceId: string): Promise<{ ok: boolean; differences: Array<{ field: string; invoice: string; expected: string }> }>;
export type PosGstSummary = {
  from: string; to: string;
  byType: Array<{ document_type: string; supply_type: string; documents: number; taxable: string; cgst: string; sgst: string; utgst: string; igst: string; cess: string; total: string }>;
  byRate: Array<{ rate: string | null; side: "invoice" | "credit_note"; taxable: string; cgst: string; sgst: string; utgst: string; igst: string; cess: string }>;
  hsn: Array<{ hsn_sac: string; uom: string; rate: string | null; quantity: string; taxable: string; tax: string }>;
  series: Array<{ document_type: string; financial_year: string; prefix: string | null; first_number: string; last_number: string; issued: number; cancelled: number }>;
};
export declare function getPosGstSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string }): Promise<PosGstSummary>;

// POS Returns (0099).
export declare const POS_RETURN_MESSAGES: Readonly<Record<string, string>>;
export type PosReturnReason = "damaged_product" | "defective_product" | "wrong_item" | "wrong_size_variant" | "customer_changed_mind" | "quality_issue" | "not_as_described" | "other";
export type PosReturnCondition = "unopened" | "good" | "opened" | "damaged" | "defective";
export type PosReturnDisposition = "return_hold" | "restock_approved" | "damaged" | "quarantined" | "rejected_not_received";
export type PosReturnStatus = "DRAFT" | "AWAITING_APPROVAL" | "AWAITING_INSPECTION" | "APPROVED" | "POSTING" | "POSTED" | "REJECTED" | "CANCELLED" | "RECOVERY_REQUIRED";
export type PosReturnRefundStatus = "NOT_INITIATED" | "PENDING" | "PROCESSING" | "PARTIALLY_REFUNDED" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "NOT_REQUIRED";
export type PosReturnEligibilityLine = {
  saleLineId: string; itemId: string; description: string; sku: string | null; uom: string | null; wholeUnits: boolean; sold: string; returned: string; heldByOpenReturns: string;
  returnable: string; unitPrice: string | null; lineTotal: string | null; discount: string | null; cartDiscount: string | null; unitRefund: string | null; unitTaxable: string | null;
  unitTax: string | null; taxRate: string | null; hsnSac: string | null; stockItem: boolean; serial: { id: string; number: string | null } | null;
  batch: { id: string; number: string | null; expiresOn: string | null; expired: boolean } | null; restriction: "blocked" | "approval" | null;
};
export type PosReturnEligibility = {
  sale: { id: string; receiptNumber: string; invoiceNumber: string | null; status: string; soldAt: string; storeId: string; grandTotal: string | null; currency: string; customerMode: string;
    customer: string | null; documentType: string | null };
  payments: Array<{ method: string; amount: string | null; refunded: string | null; card: string | null; reference: string | null }>;
  lines: PosReturnEligibilityLine[]; returnable: boolean; fullyReturned: boolean; window: { days: number | null; deadline: string | null; outside: boolean };
  crossOutlet: boolean; crossOutletAllowed: boolean;
  policy: { reasons: string[]; requireReason: boolean; requireCondition: boolean; allowPartial: boolean; allowNoReceipt: boolean; requireInspection: boolean; enabled: boolean };
};
export type PosReturnLineInput = { saleLineId: string; quantity: string; reasonCode?: PosReturnReason; reasonNote?: string; conditionCode?: PosReturnCondition; dispositionCode?: PosReturnDisposition;
  serialId?: string; batchId?: string };
export type PosReturn = {
  id: string; returnNumber: string; status: PosReturnStatus; refundStatus: PosReturnRefundStatus; version: number; saleId: string; receiptNumber: string; invoiceNumber: string | null;
  saleDate: string; storeId: string; storeName: string | null; crossOutlet: boolean; returnType: "full" | "partial"; receiptPresent: boolean; reasonSummary: string | null; currency: string;
  returnValue: string | null; taxAdjustment: string | null; refundDue: string | null; exceptions: Array<{ code: string; overridden: boolean; label: string }>; approvalRequired: boolean;
  overrideReason: string | null; requestedBy: string | null; requestedById: string; approvedBy: string | null; approvedAt: string | null; rejectionReason: string | null; cancelReason: string | null;
  postedBy: string | null; postedAt: string | null; createdAt: string; creditNoteNumber: string | null; creditNoteId: string | null;
  lines: Array<{ id: string; saleLineId: string; description: string; quantity: string; uom: string | null; reasonCode: string | null; reasonNote: string | null; conditionCode: string | null;
    dispositionCode: string | null; releasedDisposition: string | null; grossAmount: string | null; discount: string | null; cartDiscount: string | null; taxableAmount: string | null;
    taxAmount: string | null; refundAmount: string | null; serial: string | null; batch: string | null; stockMoved: boolean; hsnSac: string | null }>;
  refundAllocation: Array<{ method: string; amount: string }> | null;
  refundIds: string[];
  refundRemaining: string | null;
  refunds: Array<{ paymentId: string | null; componentId: string | null; refundId: string | null; refundNumber: string | null; method: string; amount: string | null; status: string;
    reference: string | null; confirmedAt: string | null }>;
};
export type PosReturnRow = { id: string; returnNumber: string; status: PosReturnStatus; refundStatus: PosReturnRefundStatus; refundDue: string | null; currency: string; returnType: string;
  receiptPresent: boolean; createdAt: string; postedAt: string | null; receiptNumber: string; invoiceNumber: string | null; creditNoteNumber: string | null; requestedBy: string | null; lines: number;
  exceptions: string[] };
export declare function findPosSaleForReturn(client: any, context: PointOfSaleContext, input: { code?: string; receiptNumber?: string; storeId?: string }): Promise<PosReturnEligibility>;
export declare function getPosSaleReturnEligibility(client: any, context: PointOfSaleContext, saleId: string, input?: { storeId?: string }): Promise<PosReturnEligibility>;
export declare function createPosReturn(client: any, context: PointOfSaleContext, input: { saleId: string; storeId?: string; receiptPresent?: boolean; lines: PosReturnLineInput[];
  reasonSummary?: string; overrideReason?: string; idempotencyKey: string }): Promise<PosReturn & { replayed?: boolean }>;
export declare function updatePosReturn(client: any, context: PointOfSaleContext, returnId: string, input: { lines?: PosReturnLineInput[]; receiptPresent?: boolean; overrideReason?: string | null;
  expectedVersion?: number }): Promise<PosReturn>;
export declare function requestPosReturnApproval(client: any, context: PointOfSaleContext, returnId: string, input?: { expectedVersion?: number }): Promise<PosReturn>;
export declare function approvePosReturn(client: any, context: PointOfSaleContext, returnId: string, input?: { expectedVersion?: number; note?: string }): Promise<PosReturn>;
export declare function rejectPosReturn(client: any, context: PointOfSaleContext, returnId: string, input: { reason: string; expectedVersion?: number }): Promise<PosReturn>;
export declare function cancelPosReturn(client: any, context: PointOfSaleContext, returnId: string, input?: { reason?: string; expectedVersion?: number }): Promise<PosReturn>;
export declare function recordPosReturnInspection(client: any, context: PointOfSaleContext, returnId: string, input: { lines: Array<{ lineId: string; conditionCode?: PosReturnCondition;
  dispositionCode: PosReturnDisposition }>; expectedVersion?: number }): Promise<PosReturn>;
export declare function postPosReturn(client: any, context: PointOfSaleContext, returnId: string, input: { expectedVersion?: number; cashRefundConfirmed?: boolean; idempotencyKey: string;
  refundOutcome?: string }): Promise<PosReturn & { replayed?: boolean }>;
export declare function confirmPosReturnRefund(client: any, context: PointOfSaleContext, returnId: string, input?: { paymentId?: string; externalReference?: string }): Promise<PosReturn>;
export declare function retryPosReturnRefunds(client: any, context: PointOfSaleContext, returnId: string, input?: { refundOutcome?: string }): Promise<PosReturn>;
export declare function releasePosReturnStock(client: any, context: PointOfSaleContext, returnId: string, input: { lineId: string; dispositionCode: "restock_approved" | "damaged" | "quarantined" }): Promise<PosReturn>;
export declare function getPosReturn(client: any, context: PointOfSaleContext, returnId: string): Promise<PosReturn>;
export declare function listPosReturns(client: any, context: PointOfSaleContext, options?: { search?: string; status?: string; refundStatus?: string; saleId?: string; dateFrom?: string;
  dateTo?: string; limit?: number; offset?: number }): Promise<{ rows: PosReturnRow[]; total: number }>;
export type PosReturnSummaryGroup = { key: string; lines: number; quantity: string; value: string };
export declare function getPosReturnSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string }): Promise<{
  from: string; to: string; byStatus: Array<{ status: string; returns: number }>;
  posted: { returns: number; quantity: string; gross: string; discounts: string; net: string; tax: string; refund_due: string; no_receipt: number; with_exceptions: number };
  byReason: PosReturnSummaryGroup[]; byCondition: PosReturnSummaryGroup[]; byDisposition: PosReturnSummaryGroup[]; byItem: PosReturnSummaryGroup[]; byOutlet: PosReturnSummaryGroup[];
  byCashier: PosReturnSummaryGroup[]; refunds: Array<{ method: string; status: string; refunds: number; amount: string }>;
}>;

// Refunds (0100): one shared refund service — an authorized obligation, components per original tender, attempts, reconciliation.
export declare const POS_REFUND_MESSAGES: Readonly<Record<string, string>>;
export type PosRefundSourceType = "pos_return" | "checkout_failure" | "payment_exception";
export type PosRefundStatus = "DRAFT" | "AWAITING_APPROVAL" | "AUTHORIZED" | "PROCESSING" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED_ACTION_REQUIRED" | "RECONCILIATION_REQUIRED" | "CANCELLED";
export type PosRefundComponentStatus = "PENDING" | "SUBMITTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCEL_PENDING" | "CANCELLED";
export type PosRefundEligibility = {
  sourceType: PosRefundSourceType; sourceId: string; reference: string | null; currency: string; authorizedValue: string | null; alreadyHeld: string | null; alreadyRefunded: string | null;
  remaining: string | null; refundEligible: boolean; allocationPolicy: "ORIGINAL_TENDER_PROPORTIONAL" | "ELECTRONIC_FIRST";
  tenders: Array<{ paymentId: string; method: string; taken: string | null; refundable: string | null; route: "cash" | "provider" | "manual"; card: string | null; reference: string | null }>;
};
export type PosRefundPreview = PosRefundEligibility & { amount: string | null; components: Array<{ method: string; amount: string | null; route: string }>; approvalRequired: boolean };
export type PosRefundComponent = { id: string; paymentId: string | null; method: string; route: "cash" | "provider" | "manual"; amount: string | null; paid: string | null;
  status: PosRefundComponentStatus; customerStatus: string; providerReference: string | null; error: string | null; resolvedAt: string | null };
export type PosRefundException = { id: string; refundId: string; componentId: string | null; type: string; status: string; detail: string | null; resolution: string | null; reference: string | null;
  createdAt: string; resolvedAt: string | null; refundNumber?: string; method?: string | null; amount?: string | null };
export type PosRefund = {
  id: string; refundNumber: string; status: PosRefundStatus; version: number; sourceType: PosRefundSourceType; sourceId: string; returnNumber: string | null; creditNoteNumber: string | null;
  saleId: string | null; receiptNumber: string | null; invoiceNumber: string | null; storeId: string | null; currency: string; reasonCode: string; reasonNote: string | null;
  authorizedAmount: string | null; paid: string | null; processing: string | null; waiting: string | null; outstanding: string | null; approvalRequired: boolean;
  createdBy: string | null; createdById: string; authorizedBy: string | null; createdAt: string; authorizedAt: string | null; executedAt: string | null; resolvedAt: string | null; cancelReason: string | null;
  components: PosRefundComponent[];
  attempts: Array<{ id: string; componentId: string; attempt: number; route: string; amount: string | null; status: string; providerReference: string | null; error: string | null;
    requestedAt: string; respondedAt: string | null }>;
  exceptions: PosRefundException[];
};
export type PosRefundRow = { id: string; refundNumber: string; status: PosRefundStatus; sourceType: PosRefundSourceType; sourceId: string; receiptNumber: string | null; invoiceNumber: string | null;
  authorizedAmount: string | null; paid: string | null; currency: string; methods: string | null; reasonCode: string; createdBy: string | null; createdAt: string; resolvedAt: string | null };
export declare function getPosRefundEligibility(client: any, context: PointOfSaleContext, sourceType: PosRefundSourceType, sourceId: string): Promise<PosRefundEligibility>;
export declare function previewPosRefund(client: any, context: PointOfSaleContext, sourceType: PosRefundSourceType, sourceId: string, input?: { amount?: string }): Promise<PosRefundPreview>;
export declare function createPosRefund(client: any, context: PointOfSaleContext, sourceType: PosRefundSourceType, sourceId: string, input: { amount?: string; reasonCode?: string; reasonNote?: string;
  idempotencyKey: string; preApproved?: boolean }): Promise<PosRefund & { replayed?: boolean }>;
export declare function approvePosRefund(client: any, context: PointOfSaleContext, refundId: string, input?: { expectedVersion?: number; note?: string }): Promise<PosRefund>;
export declare function executePosRefund(client: any, context: PointOfSaleContext, refundId: string, input?: { cashPayoutConfirmed?: boolean; expectedVersion?: number; idempotencyKey?: string;
  outcome?: string; fallbackShiftId?: string | null }): Promise<PosRefund>;
export declare function confirmPosRefundCash(client: any, context: PointOfSaleContext, refundId: string, input?: { componentId?: string; fallbackShiftId?: string | null }): Promise<PosRefund>;
export declare function recordPosManualRefund(client: any, context: PointOfSaleContext, refundId: string, input: { componentId: string; reference: string }): Promise<PosRefund>;
export declare function refreshPosRefund(client: any, context: PointOfSaleContext, refundId: string): Promise<PosRefund>;
export declare function retryPosRefundComponent(client: any, context: PointOfSaleContext, refundId: string, input?: { componentId?: string; outcome?: string }): Promise<PosRefund>;
export declare function cancelPosRefund(client: any, context: PointOfSaleContext, refundId: string, input: { reason: string; expectedVersion?: number }): Promise<PosRefund>;
export declare function processPosRefundProviderEvent(client: any, context: PointOfSaleContext, input: { providerRefundReference: string; status: string; amount?: string | null }): Promise<{ applied: boolean; reason?: string; status?: string }>;
export declare function getPosRefund(client: any, context: PointOfSaleContext, refundId: string): Promise<PosRefund>;
export declare function listPosRefunds(client: any, context: PointOfSaleContext, options?: { search?: string; status?: string; sourceType?: string; sourceId?: string; method?: string;
  outstanding?: boolean; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }): Promise<{ rows: PosRefundRow[]; total: number }>;
export declare function listPosRefundExceptions(client: any, context: PointOfSaleContext, options?: { status?: string }): Promise<PosRefundException[]>;
export declare function resolvePosRefundException(client: any, context: PointOfSaleContext, exceptionId: string, input: { outcome?: "refunded" | "not_refunded"; reference?: string; note: string }): Promise<PosRefundException>;
export type PosRefundSummaryGroup = { key: string; refunds: number; amount: string };
export declare function getPosRefundSummary(client: any, context: PointOfSaleContext, input?: { from?: string; to?: string }): Promise<{
  from: string; to: string;
  totals: { refunds: number; authorized: string; paid: string; outstanding: string; processing: number; failed: number; unknown: number; approved: number; average_seconds: string };
  byMethod: Array<{ method: string; status: string; components: number; amount: string; paid: string }>; bySource: PosRefundSummaryGroup[]; byReason: PosRefundSummaryGroup[];
  byOutlet: PosRefundSummaryGroup[]; byCashier: PosRefundSummaryGroup[]; cashBySession: Array<{ session: string; payouts: number; amount: string }>;
}>;
export declare function renderPosRefundAcknowledgement(client: any, context: PointOfSaleContext, refundId: string, input?: { width?: number }): Promise<{ refund: PosRefund; html: string }>;
export declare function initiatePosReturnRefund(client: any, context: PointOfSaleContext, returnId: string, input: { amount?: string; reasonNote?: string; idempotencyKey: string; execute?: boolean;
  cashRefundConfirmed?: boolean; refundOutcome?: string; preApproved?: boolean }): Promise<PosReturn>;

// POS Stock Reduction (0101)
export declare const POS_STOCK_MESSAGES: Readonly<Record<string, string>>;
export type PosStockAllocation = { id: string; number: string; status: string; quantity: number; active: number; consumed: number; location: string; batch: string | null;
  batchExpiresOn: string | null; serial: string | null; expiresAt: string | null; renewals: number };
export type PosCheckoutStockLine = { lineId: string; lineNumber: number; itemId: string; sku: string | null; description: string; quantity: number; uom: string | null; baseQuantity: number;
  baseUom: string | null; stocked: boolean; status: string; availableNow: number | null; availableBeforeReservation: number | null; reserved: number; consumed: number; allocations: PosStockAllocation[] };
export type PosCheckoutStockStatus = { cartId: string; checkoutReference: string | null; checkoutStarted: boolean; status: string;
  warehouse: { id: string; code: string; name: string; store: string } | null; warehouseError: { code: string; message: string } | null; expiresAt: string | null; saleId: string | null;
  movementsPosted: number; recovery: { status: string; code: string | null; message: string | null; at: string | null; resolvedAt: string | null } | null; lines: PosCheckoutStockLine[] };
export declare function getPosCheckoutStockStatus(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCheckoutStockStatus>;
export declare function renewPosCheckoutStock(client: any, context: PointOfSaleContext, cartId: string): Promise<{ renewed: number; expiresAt: string | null; capped?: boolean; shortfalls?: Array<{ lineId: string; shortfall: number }> }>;
export type PosSaleStockMovement = { id: string; number: string; saleLineId: string | null; lineNumber: number | null; description: string; sku: string; quantity: number; baseUom: string | null;
  warehouse: string; location: string; batch: string | null; serial: string | null; reservation: string | null; unitCost: number; value: number; valuationReferenceId: string | null;
  ledgerType: string; postedAt: string };
export declare function getPosSaleStockMovements(client: any, context: PointOfSaleContext, saleId: string): Promise<{ saleId: string; receiptNumber: string; invoiceNumber: string | null;
  status: string; inventoryReconciliationStatus: string; movementsPosted: number; costConsumed: number; movements: PosSaleStockMovement[];
  reconciliation: Array<{ lineId: string; lineNumber: number; description: string; quantity: number; uom: string | null; conversionFactor: number; expectedBaseQuantity: number;
    issuedBaseQuantity: number; stocked: boolean; status: string }> }>;
export declare function resolvePosFulfillmentWarehouse(client: any, context: PointOfSaleContext, cart: { store_id: string; terminal_id?: string | null }): Promise<{ warehouseId: string;
  warehouseCode: string; warehouseName: string; locationId: string | null; storeName: string }>;
export type PosStockSummary = { from: string; to: string;
  totals: { soldQuantity: number; issuedQuantity: number; costConsumed: number; discrepancies: number; recoveryRequired: number; activeHolds: number; overdueHolds: number;
    expiredHolds: number; consumedHolds: number; releasedHolds: number };
  byItem: Array<{ sku: string; name: string; baseUom: string | null; quantity: number; cost: number }>; byOutlet: Array<{ outlet: string; warehouse: string; sales: number; quantity: number; cost: number }>;
  byBatch: Array<{ sku: string; batch: string; expiresOn: string | null; quantity: number }>; serialsSold: Array<{ sku: string; serial: string; receiptNumber: string; soldAt: string }>;
  discrepancies: Array<{ saleId: string; receiptNumber: string; lineNumber: number; description: string; expected: number; issued: number }>;
  recovery: Array<{ cartId: string; cartReference: string; code: string | null; message: string | null; at: string; outlet: string }> };
export declare function getPosStockSummary(client: any, context: PointOfSaleContext, input?: { from?: string | null; to?: string | null; storeId?: string | null }): Promise<PosStockSummary>;
export declare function sweepExpiredPosCheckoutReservations(client: any, context: PointOfSaleContext, input?: { itemIds?: string[] | null }): Promise<{ released: number }>;
export declare function sweepPosCheckoutReservations(client: any, context: PointOfSaleContext): Promise<{ released: number }>;

// POS Real-Time Inventory (0102)
export declare const POS_INVENTORY_MESSAGES: Readonly<Record<string, string>>;
export type PosStockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "NOT_TRACKED" | "UNKNOWN";
export declare function posStockStatus(input: { stocked: boolean; available: number | null; threshold: number | null }): PosStockStatus;
export type PosInventoryScope = { storeId: string; storeName: string; warehouseId: string; warehouseCode: string; warehouseName: string; terminalId: string | null; detailed: boolean };
export type PosItemAvailability = { itemId: string; sku: string; name: string; warehouseId: string; trackingType: string; baseUom: string | null; stocked: boolean;
  availableQuantity: string | null; stockStatus: PosStockStatus; statusLabel: string; lowStockThreshold: string | null; onHandQuantity?: string; reservedQuantity?: string;
  nonSellableQuantity?: string; inventoryVersion: number; lastUpdatedAt: string | null };
type PosInventoryTarget = { cartId?: string | null; terminalId?: string | null; outletId?: string | null };
export declare function getPosBulkItemAvailability(client: any, context: PointOfSaleContext, input: PosInventoryTarget & { itemIds: string[] }): Promise<PosInventoryScope & { checkedAt: string; items: PosItemAvailability[] }>;
export declare function getPosItemStock(client: any, context: PointOfSaleContext, itemId: string, input?: PosInventoryTarget): Promise<PosInventoryScope & PosItemAvailability & {
  batches: Array<{ id: string; batchNumber: string; expiresOn: string | null; availableQuantity: string }>; serials: Array<{ id: string; serialNumber: string }>; checkedAt: string }>;
export type PosCartAvailabilityLine = { lineId: string; lineNumber: number; itemId: string; description: string; quantity: string; uom: string | null; baseQuantity: string; itemNeeded: string;
  availableQuantity: string | null; reservedForThisBill: string; stockStatus: PosStockStatus; statusLabel: string; inventoryVersion: number; warning: { code: string; message: string } | null };
export declare function getPosCartAvailability(client: any, context: PointOfSaleContext, cartId: string): Promise<PosInventoryScope & { cartId: string; inCheckout: boolean; ok: boolean;
  checkedAt: string; lines: PosCartAvailabilityLine[] }>;
export declare function authorizedPosInventoryScope(client: any, context: PointOfSaleContext, input?: { outletId?: string | null; terminalId?: string | null }): Promise<{ warehouseIds: string[]; storeIds: string[] }>;
export type PosInventoryChange = { eventId: string; sequence: number; eventType: "INVENTORY_AVAILABILITY_CHANGED"; warehouseId: string; itemId: string; inventoryVersion: number; reason: string;
  occurredAt: string };
export declare function listPosInventoryChanges(client: any, context: PointOfSaleContext, input?: { after?: number | string | null; outletId?: string | null; terminalId?: string | null;
  recentSeconds?: number }): Promise<{ cursor: number; warehouseIds: string[]; events: PosInventoryChange[] }>;
export declare function getPosInventorySyncHealth(client: any, context: PointOfSaleContext): Promise<{ checkedAt: string; eventsLastHour: number; undeliveredOverOneMinute: number;
  latestSequence: number; lastEventAt: string | null; deliveryP95Seconds: number | null; reconciliation: { consistent: boolean; issues: number; quantity: number; reservations: number;
  serials: number; ineligibleReservations: number }; status: "HEALTHY" | "DELAYED" | "RECONCILIATION_REQUIRED" }>;
export declare function prunePosInventoryEvents(client: any, organizationId: string, options?: { keepHours?: number }): Promise<{ removed: number }>;

// POS Shift Opening (0103): the rest of the lifecycle — pause, resume (the cashier signs in again), review by a supervisor.
export declare function suspendPosShift(client: any, context: PointOfSaleContext, shiftId: string, input?: { reason?: string }): Promise<PosShiftSession>;
export declare function resumePosShift(client: any, context: PointOfSaleContext, shiftId: string, input: { password: string }): Promise<PosShiftSession>;
export declare function flagPosShiftForRecovery(client: any, context: PointOfSaleContext, shiftId: string, input: { reason: string }): Promise<PosShiftSession>;
export declare function resolvePosShiftRecovery(client: any, context: PointOfSaleContext, shiftId: string, input: { resolution: string }): Promise<PosShiftSession>;

// POS Opening Cash Float (0104)
export type PosCashSourceType = "FRESH_FLOAT" | "HANDOVER" | "EXISTING_DRAWER" | "ZERO_FLOAT";
export type PosCashOpeningCount = { openingCountId: string; cashSessionId: string; shiftId: string; shiftNumber: string; cashDrawer: { id: string; code: string; name: string } | null;
  terminalCode: string; storeName: string; currency: string; openingAmount: string; sourceType: PosCashSourceType | null; sourceReference: string | null;
  denominations: Array<{ denomination: number; count: number; amount: string }> | null; confirmedBy: string | null; confirmedAt: string; status: "CONFIRMED";
  handover: { id: string; fromShiftNumber: string | null; amount?: string; closingCounted?: string; removed?: string; removalNote?: string | null } | null; variance: string | null;
  varianceReason: string | null; approval: { id: string; approver?: string | null } | null };
export type PosCashExpectedBalance = { cashSessionId: string; shiftNumber: string; status: string; currency: string; expectedCash: string; countedAtClose: string | null;
  closingVariance: string | null; events: number; breakdown: { openingFloat: string; cashReceived: string; changeGiven: string; uncompletedTendersReturned: string; cashRefundsPaid: string;
  cashMovementIn: string; cashMovementOut: string; closingAdjustments: string } };
export type PosCashOpeningCorrection = { id: string; confirmedAmount: string; correctedAmount: string; difference: string; reason: string; recordedBy: string | null; recordedAt: string };
export type PosCashSessionDetail = { id: string; shiftId: string; shiftNumber: string; status: string; shiftStatus: string; storeName: string; terminalCode: string; terminalName: string;
  openedAt: string; closedAt: string | null; openingCount: PosCashOpeningCount; corrections: PosCashOpeningCorrection[]; expected: PosCashExpectedBalance | null };
export declare function getPosCashSession(client: any, context: PointOfSaleContext, cashSessionId: string): Promise<PosCashSessionDetail>;
export declare function getPosCashOpeningCount(client: any, context: PointOfSaleContext, cashSessionId: string): Promise<PosCashOpeningCount>;
export declare function getCashSessionExpectedBalance(client: any, context: PointOfSaleContext, cashSessionId: string): Promise<PosCashExpectedBalance>;
export declare function recordPosOpeningCorrection(client: any, context: PointOfSaleContext, cashSessionId: string, input: { correctedAmount: string; reason: string }): Promise<PosCashSessionDetail & { id: string }>;
export declare function listPosCashOpeningHistory(client: any, context: PointOfSaleContext, filters?: { from?: string; to?: string; storeId?: string; drawerId?: string; sourceType?: string;
  withVariance?: boolean | string; limit?: number; offset?: number }): Promise<{ total: number; rows: Array<PosCashOpeningCount & { cashier: string | null; status: string; corrections: number }> }>;
export declare function getCashDrawerHandover(client: any, context: PointOfSaleContext, drawerId: string): Promise<Record<string, unknown> | null>;
export type PosCashDrawer = { id: string; storeId: string; storeName: string; code: string; name: string; status: "active" | "inactive"; terminals: string[]; heldByShift: string | null; heldBy: string | null };
export declare function listPosCashDrawers(client: any, context: PointOfSaleContext, input?: { storeId?: string | null }): Promise<PosCashDrawer[]>;
export declare function savePosCashDrawer(client: any, context: PointOfSaleContext, input: { id?: string; storeId?: string; code: string; name: string; status?: "active" | "inactive" }): Promise<Record<string, unknown>>;
export declare function assignTerminalCashDrawer(client: any, context: PointOfSaleContext, terminalId: string, drawerId: string): Promise<{ terminalId: string; cashDrawerId: string; drawerCode: string }>;

// POS Shift Closing (0105).
export declare const POS_SHIFT_CLOSE_MESSAGES: Readonly<Record<string, string>>;
export declare const CASH_DESTINATIONS: readonly string[];
export declare const CLOSING_VARIANCE_REASONS: Readonly<Record<string, string>>;
export declare function getShiftClosingContext(client: any, context: PointOfSaleContext, options?: { shiftId?: string | null }): Promise<any>;
export declare function getShiftBlockingTransactions(client: any, context: PointOfSaleContext, shiftId: string): Promise<any>;
export declare function getShiftPaymentSummary(client: any, context: PointOfSaleContext, shiftId: string): Promise<any>;
export declare function beginShiftClosing(client: any, context: PointOfSaleContext, shiftId: string, input?: Record<string, any>): Promise<any>;
export declare function cancelShiftClosing(client: any, context: PointOfSaleContext, shiftId: string, input?: Record<string, any>): Promise<any>;
export declare function submitBlindCashCount(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;
export declare function getShiftCashReconciliation(client: any, context: PointOfSaleContext, shiftId: string): Promise<any>;
export declare function requestShiftClosingApproval(client: any, context: PointOfSaleContext, shiftId: string, input?: Record<string, any>): Promise<any>;
export declare function assignShiftClosingException(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;
export declare function prepareCashHandover(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;
export declare function finalizeShiftClosing(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;
export declare function closeShift(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;
export declare function recoverShiftClosing(client: any, context: PointOfSaleContext, shiftId: string): Promise<any>;
export declare function getShiftClosingReport(client: any, context: PointOfSaleContext, shiftId: string, options?: { variant?: string | null }): Promise<any>;
export declare function recordShiftClosingPrint(client: any, context: PointOfSaleContext, shiftId: string, input?: Record<string, any>): Promise<any>;
export declare function getShiftClosingHistory(client: any, context: PointOfSaleContext, filters?: Record<string, any>): Promise<{ total: number; rows: any[] }>;
export declare function listCashCustodyTransfers(client: any, context: PointOfSaleContext, filters?: Record<string, any>): Promise<any[]>;
export declare function acceptCashCustodyTransfer(client: any, context: PointOfSaleContext, transferId: string, input: Record<string, any>): Promise<any>;
export declare function listShiftClosingExceptions(client: any, context: PointOfSaleContext, filters?: Record<string, any>): Promise<any[]>;
export declare function resolveShiftClosingException(client: any, context: PointOfSaleContext, exceptionId: string, input: Record<string, any>): Promise<any>;

// POS Cash Difference (0106).
export declare const CASH_DIFFERENCE_MESSAGES: Readonly<Record<string, string>>;
export declare const CASH_DIFFERENCE_REASONS: Readonly<Record<string, string>>;
export declare const FINANCE_TREATMENTS: readonly string[];
export declare const RESOLUTION_TYPES: readonly string[];
export declare function cashLedgerVersion(client: any, organizationId: string, shiftId: string): Promise<number>;
export declare function closingVariancePolicy(row: Record<string, any> | null | undefined): Record<string, any>;
export declare function evaluateCashVariance(policy: Record<string, any>, difference: bigint): Record<string, any>;
export declare function getCashSessionReconciliation(client: any, context: PointOfSaleContext, cashSessionId: string): Promise<any>;
export declare function submitCashSessionCount(client: any, context: PointOfSaleContext, cashSessionId: string, input: Record<string, any>): Promise<any>;
export declare function requestCashSessionVarianceApproval(client: any, context: PointOfSaleContext, cashSessionId: string, input?: Record<string, any>): Promise<any>;
export declare function getCashDifference(client: any, context: PointOfSaleContext, differenceId: string): Promise<any>;
export declare function listCashDifferences(client: any, context: PointOfSaleContext, filters?: Record<string, any>): Promise<{ total: number; rows: any[] }>;
export declare function getCashDifferenceSummary(client: any, context: PointOfSaleContext, filters?: Record<string, any>): Promise<any>;
export declare function investigateCashDifference(client: any, context: PointOfSaleContext, differenceId: string, input: Record<string, any>): Promise<any>;
export declare function resolveCashDifference(client: any, context: PointOfSaleContext, differenceId: string, input: Record<string, any>): Promise<any>;
export declare function recordCashDifferenceFinanceTreatment(client: any, context: PointOfSaleContext, differenceId: string, input: Record<string, any>): Promise<any>;

// POS Day-End / Z Report (0107).
export declare const POS_DAY_END_MESSAGES: Readonly<Record<string, string>>;
export declare function resolveOutletBusinessDay(client: any, context: PointOfSaleContext, storeId: string, businessDate?: string | null): Promise<{ day: any; store: any }>;
export declare function setOutletBusinessDayCutoff(client: any, context: PointOfSaleContext, storeId: string, input: { cutoff: string }): Promise<any>;
export declare function getDayEndContext(client: any, context: PointOfSaleContext, options?: { storeId?: string | null; businessDate?: string | null }): Promise<any>;
export declare function buildXReport(client: any, context: PointOfSaleContext, dayId: string): Promise<any>;
export declare function getDayEndReadiness(client: any, context: PointOfSaleContext, dayId: string): Promise<any>;
export declare function beginDayEndClosing(client: any, context: PointOfSaleContext, dayId: string, input?: Record<string, any>): Promise<any>;
export declare function requestDayEndApproval(client: any, context: PointOfSaleContext, dayId: string, input: Record<string, any>): Promise<any>;
export declare function approveDayEndExceptions(client: any, context: PointOfSaleContext, dayId: string, input: Record<string, any>): Promise<any>;
export declare function finalizeZReport(client: any, context: PointOfSaleContext, dayId: string, input: Record<string, any>): Promise<any>;
export declare function recoverDayEndFinalization(client: any, context: PointOfSaleContext, dayId: string): Promise<any>;
export declare function getZReport(client: any, context: PointOfSaleContext, reportId: string): Promise<any>;
export declare function getZReportForDay(client: any, context: PointOfSaleContext, dayId: string): Promise<any>;
export declare function listZReports(client: any, context: PointOfSaleContext, filters?: Record<string, any>): Promise<{ total: number; rows: any[] }>;
export declare function recordZReportPrint(client: any, context: PointOfSaleContext, reportId: string, input?: Record<string, any>): Promise<any>;
export declare function syncZReportAdjustments(client: any, context: PointOfSaleContext, reportId: string): Promise<any[]>;
export declare function listZReportAdjustments(client: any, context: PointOfSaleContext, reportId: string): Promise<any[]>;
export declare function recordZReportAdjustment(client: any, context: PointOfSaleContext, reportId: string, input: Record<string, any>): Promise<any>;

// Payment Reconciliation (0108).
export declare const RECONCILIATION_MESSAGES: Readonly<Record<string, string>>;
export declare const RECONCILIATION_ADAPTERS: readonly string[];
export declare const STANDARD_SETTLEMENT_COLUMNS: readonly string[];
export declare function applyManualMatch(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function approveManualMatch(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function commitSettlementImport(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function getPaymentReconciliationStatus(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function getReconciliationException(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function getReconciliationOverview(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function getReconciliationRun(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function getSettlementBatch(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function listMerchantAccounts(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function listReconciliationExceptions(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function listSettlementBatches(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function matchBankReceipts(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function postSettlementToFinance(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function previewSettlementImport(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function recoverReconciliationRuns(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function resolveReconciliationException(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function reverseMatch(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function saveMerchantAccount(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function startReconciliationRun(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function suggestReconciliationMatches(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function updateReconciliationException(client: any, context: PointOfSaleContext, ...args: any[]): Promise<any>;
export declare function getReconciliationReport(client: any, context: PointOfSaleContext, type: string, filters?: Record<string, any>): Promise<any>;
export declare function listReconciliationBankAccounts(client: any, context: PointOfSaleContext): Promise<any[]>;
export declare function reconciliationSummaryForSales(client: any, organizationId: string, saleIds: string[]): Promise<any>;

export type SalesQueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type SalesContext = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
export class SalesError extends Error { readonly status: number; readonly code: string; constructor(status: number, message: string, code?: string); }
export function previewSalesDocument(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, options?: { order?: boolean; allowMissingPrice?: boolean; preview?: boolean; carryQuotedPrices?: boolean }): Promise<any>;
export function getSalesReport(client: SalesQueryClient, context: SalesContext, key: string, filters?: { from?: string; to?: string; financialYear?: string | number; customerId?: string; salespersonId?: string; registrationId?: string; currency?: string }): Promise<any[]>;
export function getSalesOptions(client: SalesQueryClient, context: SalesContext, opportunityId?: string | null, partyId?: string | null, options?: { itemIds?: string[] }): Promise<any>;
// The pickers' search (Sales audit B4).
export function searchSalesOptions(client: SalesQueryClient, context: SalesContext, input: { kind: "customers" | "products"; q?: string; prospects?: boolean }): Promise<any>;

export function accrueSalesCommission(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;

export function getSalesSettings(client: SalesQueryClient, context: SalesContext): Promise<Record<string, any>>;
export function listSalesSettingsWarehouses(client: SalesQueryClient, context: SalesContext): Promise<Array<{ id: string; code: string; name: string }>>;
export function updateSalesSettings(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<Record<string, any>>;

export * from "./price-lists/index.js";
export * from "./pricing-rules/index.js";
// Sending a Sales document on WhatsApp (Sales audit M6).
export function sendDocumentOnWhatsApp(client: SalesQueryClient, context: SalesContext, input: { kind: "quotation" | "proforma" | "order" | "invoice" | "credit_note" | "debit_note" | "receipt" | "reminder"; id: string; phone?: string; body?: string; idempotencyKey?: string }): Promise<{ phone: string; body: string; link: string }>;

export * from "./quotations/index.js";

export * from "./orders/index.js";

export * from "./order-confirmations/index.js";

export * from "./availability/index.js";

export * from "./reservations/index.js";

export * from "./deliveries/index.js";

export * from "./invoices/index.js";

export * from "./returns/index.js";
export * from "./credit-notes/index.js";
export * from "./order-tracking/index.js";
export * from "./home/index.js";
export const DISCOUNT_PERMISSIONS: Readonly<Record<"applyLine" | "applyDocument" | "aboveLimit" | "overrideLimit" | "manageSettings", string>>;
export const DISCOUNT_REASONS: ReadonlyArray<{ code: string; label: string }>;
// Commission rules, invoiced-value targets and salesperson performance (Sales audit).
export function listCommissionRules(client: SalesQueryClient, context: SalesContext): Promise<any>;
export function saveCommissionRule(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, ruleId?: string | null): Promise<any>;
export function setCommissionRuleStatus(client: SalesQueryClient, context: SalesContext, ruleId: string, active: boolean): Promise<any>;
export function setInvoicedTarget(client: SalesQueryClient, context: SalesContext, input: { userId: string; month: string; target: number }): Promise<any>;
export function getSalesPerformance(client: SalesQueryClient, context: SalesContext, filters?: { month?: string }): Promise<any>;
// Delivery challans without Stock (Sales audit).
export const CHALLAN_PURPOSES: ReadonlyArray<{ code: string; label: string }>;
export function listSalesChallans(client: SalesQueryClient, context: SalesContext, filters?: { status?: string; search?: string }): Promise<any>;
export function getSalesChallan(client: SalesQueryClient, context: SalesContext, challanId: string): Promise<any>;
export function createSalesChallan(client: SalesQueryClient, context: SalesContext, input: Record<string, any>): Promise<any>;
export function setSalesChallanStatus(client: SalesQueryClient, context: SalesContext, challanId: string, input: { action: "issue" | "cancel"; reason?: string }): Promise<any>;
// Simple Sales access levels (Sales audit).
export const SALES_ACCESS_LEVELS: ReadonlyArray<{ key: string; label: string; slug: string | null; description: string }>;
export function listSalesAccess(client: SalesQueryClient, session: any): Promise<any>;
export function setSalesAccessLevel(client: SalesQueryClient, session: any, userId: string, level: string): Promise<any>;
// Rate contracts (Sales audit).
export function listRateContracts(client: SalesQueryClient, context: SalesContext, filters?: { status?: string; partyId?: string }): Promise<any>;
export function getRateContract(client: SalesQueryClient, context: SalesContext, contractId: string): Promise<any>;
export function saveRateContract(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, contractId?: string | null): Promise<any>;
export function setRateContractStatus(client: SalesQueryClient, context: SalesContext, contractId: string, action: "activate" | "close" | "cancel"): Promise<any>;
// The customer's link to a quotation or invoice (Sales audit).
export function shareDocumentLink(client: SalesQueryClient, context: SalesContext, kind: "quotation" | "invoice", documentId: string, env?: Record<string, string | undefined>): Promise<{ url: string; documentNumber: string }>;
export function revokeDocumentLink(client: SalesQueryClient, context: SalesContext, kind: "quotation" | "invoice", documentId: string): Promise<{ revoked: boolean }>;
export function loadSharedDocument(client: SalesQueryClient, token: string, env?: Record<string, string | undefined>): Promise<any>;
export function acceptSharedQuotation(client: SalesQueryClient, token: string, input: { name: string; note?: string; signature?: string; optionalChosen?: number[] },
  env?: Record<string, string | undefined>): Promise<{ accepted: boolean; orderNumber?: string } | null>;
export function declineSharedQuotation(client: SalesQueryClient, token: string, input: { name: string; reason: string }): Promise<{ declined: boolean } | null>;
export function requestQuotationChanges(client: SalesQueryClient, token: string, input: { name: string; note: string }): Promise<{ requested: boolean } | null>;
export function renderSharedDocumentPdf(client: SalesQueryClient, token: string): Promise<{ fileName: string; body: Uint8Array } | null>;
// Sales imports that run in the background (Line-by-line audit P5).
export type SalesDataJob = { id: string; entity: "customers" | "customer_addresses" | "customer_contacts" | "prices"; entityLabel: string; status: "queued" | "running" | "succeeded" | "failed";
  fileName: string | null; result: Record<string, any>; error: string | null; hasOutput: boolean; requestedByName: string | null; requestedAt: string; startedAt: string | null; completedAt: string | null };
export const BACKGROUND_IMPORT_ROW_LIMIT: number;
export const SALES_DATA_JOB_TYPE: string;
export function requestSalesImportJob(client: SalesQueryClient, context: SalesContext, input: { entity: string; bytes: Uint8Array; fileName: string; mapping?: Record<string, string>; options?: Record<string, unknown> }, options?: { env?: Record<string, string | undefined>; storage?: unknown }): Promise<SalesDataJob>;
export function listSalesDataJobs(client: SalesQueryClient, context: SalesContext, input?: { entities?: string[]; limit?: number }): Promise<SalesDataJob[]>;
export function getSalesDataJob(client: SalesQueryClient, context: SalesContext, jobId: string): Promise<SalesDataJob>;
export function readSalesDataJobOutput(client: SalesQueryClient, context: SalesContext, jobId: string, options?: { storage?: unknown }): Promise<{ body: Uint8Array; fileName?: string; mimeType?: string; [key: string]: unknown }>;
export function executeSalesDataJob(client: SalesQueryClient, organizationId: string, payload: { salesDataJobId: string }, options?: { env?: Record<string, string | undefined>; storage?: unknown }): Promise<Record<string, unknown>>;
export function failSalesDataJob(client: SalesQueryClient, organizationId: string, salesDataJobId: string, error: unknown): Promise<void>;
// Sales plan (Phase 2–4).
export const SALES_PAYMENT_METHODS: Readonly<Record<string, string>>;
export function allocateOldestFirst(invoices: Array<{ id: string; outstanding_amount: number }>, amount: number): Array<{ invoiceId: string; amount: number }>;
export function getCustomerOpenItems(client: SalesQueryClient, context: SalesContext, partyId: string): Promise<any>;
export function recordCustomerPayment(client: SalesQueryClient, context: SalesContext, input: Record<string, any>): Promise<{ receiptId: string; receiptNumber: string; amount: number; applied: number; advance: number; allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: number; tds: number }> }>;
export function listInvoiceAdvances(client: SalesQueryClient, context: SalesContext, invoiceId: string): Promise<any>;
export function applyAdvanceToInvoice(client: SalesQueryClient, context: SalesContext, invoiceId: string, input?: { receiptId?: string; amount?: number }): Promise<any>;
export function getSalesPayment(client: SalesQueryClient, context: SalesContext, receiptId: string): Promise<any>;
export function listCollectionNotes(client: SalesQueryClient, context: SalesContext, partyId: string): Promise<any>;
export function addCollectionNote(client: SalesQueryClient, context: SalesContext, partyId: string, input: Record<string, any>): Promise<any>;
export function getCustomerStatementDocument(client: SalesQueryClient, context: SalesContext, partyId: string, options?: { from?: string; to?: string }): Promise<any>;
export const SALES_DEBIT_REASONS: ReadonlyArray<{ code: string; label: string }>;
export function getDebitNoteProposal(client: SalesQueryClient, context: SalesContext, invoiceId: string): Promise<any>;
export function createDebitNote(client: SalesQueryClient, context: SalesContext, invoiceId: string, input: Record<string, any>): Promise<{ debitNoteId: string; debitNoteNumber: string; status: string; replayed: boolean }>;
export function postDebitNote(client: SalesQueryClient, context: SalesContext, debitNoteId: string): Promise<any>;
export function cancelDraftDebitNote(client: SalesQueryClient, context: SalesContext, debitNoteId: string, input?: { reason?: string }): Promise<any>;
export function getDebitNote(client: SalesQueryClient, context: SalesContext, debitNoteId: string): Promise<any>;
export function getDebitNoteDocument(client: SalesQueryClient, context: SalesContext, debitNoteId: string): Promise<any>;
export function listDebitNotes(client: SalesQueryClient, context: SalesContext, filters?: Record<string, any>): Promise<any>;
export const SALES_TEMPLATE_KINDS: ReadonlyArray<{ kind: string; label: string; placeholders: string[] }>;
export function listMessageTemplates(client: SalesQueryClient, context: SalesContext): Promise<any>;
export function saveMessageTemplate(client: SalesQueryClient, context: SalesContext, input: { kind: string; channel: string; body?: string | null }): Promise<any>;
export const SALES_ROUTE_WEEKDAYS: ReadonlyArray<{ day: number; label: string }>;
export function listSalesRoutes(client: SalesQueryClient, context: SalesContext, filters?: { status?: string; today?: boolean | string }): Promise<any>;
export function saveSalesRoute(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, routeId?: string | null): Promise<any>;
export function assignCustomersToRoute(client: SalesQueryClient, context: SalesContext, input: { customerIds: string[]; routeId: string | null }): Promise<{ updated: number }>;
export function createDeliveriesForOrders(client: SalesQueryClient, context: SalesContext, input: { orderIds: string[]; idempotencyKey: string; dispatch?: boolean }): Promise<any>;
export function createInvoicesForOrders(client: SalesQueryClient, context: SalesContext, input: { orderIds: string[]; idempotencyKey: string }): Promise<any>;
export function finaliseInvoicesInBulk(client: SalesQueryClient, context: SalesContext, input: { invoiceIds: string[]; idempotencyKey: string },
  options?: { afterFinal?: (invoiceId: string) => Promise<unknown> }): Promise<{ results: Array<{ invoiceId: string; invoiceNumber: string | null; finalised?: boolean; alreadyFinal?: boolean; einvoice?: unknown; error?: string }>; finalised: number }>;
export function sendInvoicesInBulk(client: SalesQueryClient, context: SalesContext, input: { invoiceIds: string[]; idempotencyKey: string },
  options: { renderPdf: (invoiceId: string) => Promise<{ fileName: string; content: Uint8Array | Buffer }> }): Promise<{ results: Array<{ invoiceId: string; invoiceNumber: string | null; sentTo?: string; error?: string }>; sent: number }>;
export function requestCreditRelease(client: SalesQueryClient, context: SalesContext, orderId: string, input?: { note?: string }): Promise<any>;
export function allocateStockFairShare(client: SalesQueryClient, context: SalesContext, input: { itemId: string; warehouseId: string; preview?: boolean; idempotencyKey?: string }): Promise<any>;

// Quotation templates (Sales report Phase 2).
export type QuotationTemplate = {
  id: string; name: string; description: string | null; validityDays: number | null; paymentTermId: string | null; termsAndConditions: string | null;
  customerNotes: string | null; lines: Array<{ itemId: string; quantity: number; uomId: string | null; description: string | null; discountType?: "percent" | "amount"; discountValue?: number }>;
  sectionLines: Array<{ kind: "section" | "note"; text: string; position: number }>; active: boolean; updatedAt: string; lineCount: number;
};
export type QuotationTemplateInput = {
  name?: string; description?: string | null; validityDays?: number | null; paymentTermId?: string | null; termsAndConditions?: string | null; customerNotes?: string | null;
  lines?: Array<{ itemId: string; quantity: number; uomId?: string | null; description?: string | null; discountType?: "percent" | "amount"; discountValue?: number }>;
  sectionLines?: Array<{ kind: "section" | "note"; text: string; position: number }>;
};
export function listQuotationTemplates(client: SalesQueryClient, context: SalesContext, options?: { includeInactive?: boolean }): Promise<{ templates: QuotationTemplate[] }>;
export function getQuotationTemplate(client: SalesQueryClient, context: SalesContext, templateId: string): Promise<{ template: QuotationTemplate }>;
export function createQuotationTemplate(client: SalesQueryClient, context: SalesContext, input: QuotationTemplateInput): Promise<{ template: QuotationTemplate }>;
export function updateQuotationTemplate(client: SalesQueryClient, context: SalesContext, templateId: string, input: QuotationTemplateInput): Promise<{ template: QuotationTemplate }>;
export function setQuotationTemplateActive(client: SalesQueryClient, context: SalesContext, templateId: string, active: boolean): Promise<{ template: QuotationTemplate }>;
export function deleteQuotationTemplate(client: SalesQueryClient, context: SalesContext, templateId: string): Promise<{ deleted: boolean }>;

// Cheque register (Sales report Phase 2).
export type SalesCheque = {
  id: string; partyId: string; customerName: string; receiptId: string | null; receiptNumber: string | null; chequeNumber: string; chequeDate: string; draweeBank: string | null;
  amount: number; currencyCode: string; status: "received" | "deposited" | "cleared" | "bounced" | "cancelled"; statusLabel: string; postDated: boolean; dueToDeposit: boolean;
  depositedOn: string | null; clearedOn: string | null; bouncedOn: string | null; bounceReason: string | null; bounceCharge: number | null; bounceDebitNoteId: string | null;
  reference: string | null; notes: string | null; createdAt: string;
};
export type ChequeStepResult = { results: Array<{ chequeId: string; chequeNumber: string; done?: boolean; receiptNumber?: string; error?: string }>; done: number };
export const CHEQUE_STATUSES: Readonly<Record<string, string>>;
export function listCheques(client: SalesQueryClient, context: SalesContext, options?: { view?: string; partyId?: string; search?: string }): Promise<{
  cheques: SalesCheque[]; counts: { inHand: number; postDated: number; deposited: number; dueToDeposit: number } }>;
export function depositCheques(client: SalesQueryClient, context: SalesContext, input: { chequeIds: string[]; depositedOn?: string }): Promise<ChequeStepResult>;
export function clearCheques(client: SalesQueryClient, context: SalesContext, input: { chequeIds: string[]; clearedOn?: string }): Promise<ChequeStepResult>;
export function bounceCheque(client: SalesQueryClient, context: SalesContext, chequeId: string, input: { reason: string; bouncedOn?: string; charge?: number | null }): Promise<{
  chequeId: string; receiptReversed: boolean; debitNoteId: string | null; debitNoteNumber: string | null; chargeNote: string | null }>;
export function cancelPostDatedCheque(client: SalesQueryClient, context: SalesContext, chequeId: string, input?: { reason?: string }): Promise<{ chequeId: string; cancelled: boolean }>;

// Automatic payment reminders (Sales report Phase 2).
export type ReminderRule = { id: string; name: string; daysOffset: number; sendEmail: boolean; sendWhatsApp: boolean; whatsappTemplate: string | null; whatsappLanguage: string;
  subject: string | null; message: string | null; active: boolean; when: string };
export type ReminderRuleInput = { name?: string; daysOffset?: number; sendEmail?: boolean; sendWhatsApp?: boolean; whatsappTemplate?: string | null; whatsappLanguage?: string;
  subject?: string | null; message?: string | null };
export type ReminderLogEntry = { id: string; ruleName: string | null; partyId: string; customerName: string | null; invoiceId: string; invoiceNumber: string | null; runOn: string;
  status: "previewed" | "sent" | "failed" | "skipped"; channels: string[]; amountDue: number | null; detail: string | null };
export const DEFAULT_REMINDER_MESSAGE: string;
export function getPaymentReminders(client: SalesQueryClient, context: SalesContext): Promise<{ mode: "off" | "preview" | "send"; rules: ReminderRule[]; defaultMessage: string }>;
export function setPaymentRemindersMode(client: SalesQueryClient, context: SalesContext, mode: string): Promise<{ mode: string }>;
export function saveReminderRule(client: SalesQueryClient, context: SalesContext, input: ReminderRuleInput, ruleId?: string | null): Promise<{ rule: ReminderRule }>;
export function setReminderRuleActive(client: SalesQueryClient, context: SalesContext, ruleId: string, active: boolean): Promise<{ rule: ReminderRule }>;
export function deleteReminderRule(client: SalesQueryClient, context: SalesContext, ruleId: string): Promise<{ deleted: boolean }>;
export function setCustomerRemindersPaused(client: SalesQueryClient, context: SalesContext, partyId: string, paused: boolean): Promise<{ paused: boolean }>;
export function listReminderLog(client: SalesQueryClient, context: SalesContext, options?: { partyId?: string; limit?: number }): Promise<{ log: ReminderLogEntry[] }>;
export function runPaymentReminders(client: SalesQueryClient, context: SalesContext, options?: { today?: string; env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch }): Promise<{ mode: string; sent: number; previewed: number; failed: number; skipped: number }>;

// GST on advances (Sales report Phase 2).
export type ReceiptVoucher = {
  id: string; number: string; date: string; partyId: string; customerName: string | null; customerGstin: string | null; receiptId: string; sellerGstin: string | null;
  placeOfSupply: string; supplyNature: "intra" | "inter"; description: string | null; sacHsn: string | null; rate: number; amount: number; taxable: number; igst: number; cgst: number;
  sgst: number; used: number; refunded: number; left: number; status: "issued" | "partly_used" | "used" | "refunded" | "cancelled";
};
export type ReceiptVoucherDetail = ReceiptVoucher & {
  uses: Array<{ invoiceId: string; invoiceNumber: string; date: string; amount: number }>;
  refunds: Array<{ id: string; number: string; date: string; amount: number; reason: string }>;
};
export function taxOfAdvance(gross: number, rate: number, nature: "intra" | "inter"): { taxable: number; igst: number; cgst: number; sgst: number };
export function issueReceiptVoucher(client: SalesQueryClient, context: SalesContext, input: { receiptId: string; amount?: number; rate: number; description?: string; sacHsn?: string;
  voucherDate?: string }): Promise<{ voucher: ReceiptVoucher }>;
export function listReceiptVouchers(client: SalesQueryClient, context: SalesContext, options?: { receiptId?: string; partyId?: string; invoiceId?: string }): Promise<{ vouchers: ReceiptVoucherDetail[] }>;
export function adjustReceiptVouchers(client: SalesQueryClient, context: SalesContext, input: { receiptId: string; invoiceId: string; amount: number; date?: string }): Promise<unknown[]>;
export function issueRefundVoucher(client: SalesQueryClient, context: SalesContext, voucherId: string, input: { amount?: number; refundDate?: string; reason: string }): Promise<{
  refundVoucherId: string; number: string; amount: number; taxable: number; igst: number; cgst: number; sgst: number }>;
export function setReceiptVouchersFrom(client: SalesQueryClient, context: SalesContext, from: string | null): Promise<{ from: string | null }>;

// Sales warnings (Sales report Phase 3).
export type SalesDocumentWarning = { kind: "customer" | "product"; partyId?: string; itemId?: string; name: string; message: string };
export function setCustomerSalesWarning(client: SalesQueryClient, context: SalesContext, partyId: string, input: { message?: string | null }): Promise<{ message: string | null }>;
export function setProductSalesWarning(client: SalesQueryClient, context: SalesContext, itemId: string, input: { level: "none" | "warn" | "block"; message?: string | null }): Promise<{
  level: string; message: string | null }>;
export function setProductInvoiceBasis(client: SalesQueryClient, context: SalesContext, itemId: string, basis: "ordered" | "delivered" | null): Promise<{ basis: string | null }>;

// Export invoices (Sales report Phase 3).
export function setInvoiceExportDetails(client: SalesQueryClient, context: SalesContext, invoiceId: string, input: { shippingBillNumber?: string | null; shippingBillDate?: string | null;
  portCode?: string | null }): Promise<{ shippingBillNumber: string | null; shippingBillDate: string | null; portCode: string | null }>;
export function setRegistrationLut(client: SalesQueryClient, context: SalesContext, registrationId: string, input: { lutNumber?: string | null; lutDate?: string | null }): Promise<{
  lutNumber: string | null; lutDate: string | null }>;

// Customer TDS certificates (Sales report Phase 3).
export type TdsCertificateRow = { partyId: string; customerName: string; pan: string | null; quarter: number; quarterLabel: string; dueOn: string; expected: number; received: number;
  missing: number; status: "received" | "partly" | "missing"; overdue: boolean; sections: string[];
  certificates: Array<{ id: string; number: string; amount: number; receivedOn: string; section: string | null }> };
export const TDS_QUARTERS: ReadonlyArray<{ quarter: number; label: string; months: number[] }>;
export function financialYearOf(day: string): number;
export function getTdsCertificates(client: SalesQueryClient, context: SalesContext, options?: { financialYear?: number; partyId?: string }): Promise<{
  financialYear: number; label: string; rows: TdsCertificateRow[]; totals: { expected: number; received: number; missing: number }; overdue: number }>;
export function recordTdsCertificate(client: SalesQueryClient, context: SalesContext, input: { partyId: string; financialYear: number; quarter: number; certificateNumber: string;
  amount: number; receivedOn?: string; section?: string; notes?: string }): Promise<{ certificateId: string }>;
export function deleteTdsCertificate(client: SalesQueryClient, context: SalesContext, certificateId: string): Promise<{ deleted: boolean }>;

// Sales analysis (Sales report Phase 3).
export type SalesAnalysisDimension = "customer" | "product" | "salesperson" | "beat" | "state" | "month";
export const ANALYSIS_DIMENSIONS: Readonly<Record<SalesAnalysisDimension, { label: string }>>;
export const ANALYSIS_MEASURES: Readonly<Record<"amount" | "quantity" | "invoices", { label: string }>>;
export type SalesAnalysis = { from: string; to: string; rowsBy: SalesAnalysisDimension; columnsBy: SalesAnalysisDimension | null; measure: string; measureLabel: string;
  rows: Array<{ key: string; label: string; total: number }>; columns: Array<{ key: string; label: string; total: number }>; cells: Record<string, Record<string, number>>; total: number;
  truncated: boolean };
export function getSalesAnalysis(client: SalesQueryClient, context: SalesContext, options?: { rows?: string; columns?: string | null; measure?: string; from?: string; to?: string }): Promise<SalesAnalysis>;
export function exportSalesAnalysis(client: SalesQueryClient, context: SalesContext, options?: { rows?: string; columns?: string | null; measure?: string; from?: string; to?: string }): Promise<{
  fileName: string; body: Uint8Array }>;

// Variant grid (Sales report Phase 3).
export function searchVariantTemplates(client: SalesQueryClient, context: SalesContext, options?: { search?: string }): Promise<{ templates: Array<{ id: string; code: string; name: string; variants: number }> }>;
export function getVariantGrid(client: SalesQueryClient, context: SalesContext, templateId: string): Promise<{ template: { id: string; code: string; name: string };
  rowAttribute: string | null; columnAttribute: string | null; rows: string[]; columns: string[]; cells: Record<string, { itemId: string; code: string; name: string }> }>;

// Delivery methods (Sales report Phase 3).
export type DeliveryMethod = { id: string; name: string; basis: "fixed" | "per_kg" | "percent"; basisLabel: string; rate: number; minimumCharge: number | null; freeAbove: number | null;
  stateCodes: string[]; active: boolean };
export type DeliveryMethodInput = { name: string; basis: string; rate: number; minimumCharge?: number | null; freeAbove?: number | null; stateCodes?: string[] };
export function listDeliveryMethods(client: SalesQueryClient, context: SalesContext, options?: { includeInactive?: boolean }): Promise<{ methods: DeliveryMethod[] }>;
export function saveDeliveryMethod(client: SalesQueryClient, context: SalesContext, input: DeliveryMethodInput, methodId?: string | null): Promise<{ method: DeliveryMethod }>;
export function setDeliveryMethodActive(client: SalesQueryClient, context: SalesContext, methodId: string, active: boolean): Promise<{ method: DeliveryMethod }>;
export function deliveryMethodCharge(client: SalesQueryClient, context: SalesContext, methodId: string | null, input: { lines: unknown[]; value: number; stateCode: string | null }): Promise<{
  charge: number; method: DeliveryMethod } | null>;
export type Coupon = { id: string; code: string; description: string | null; discountType: "amount" | "percent"; value: number; maximumDiscount: number | null;
  minimumOrder: number | null; validFrom: string | null; validTo: string | null; usesTotal: number | null; usesPerCustomer: number | null; used?: number; active: boolean };
export type CouponInput = { code: string; description?: string | null; discountType: string; value: number; maximumDiscount?: number | null; minimumOrder?: number | null;
  validFrom?: string | null; validTo?: string | null; usesTotal?: number | null; usesPerCustomer?: number | null };
export function listCoupons(client: SalesQueryClient, context: SalesContext, options?: { includeInactive?: boolean }): Promise<{ coupons: Coupon[] }>;
export function saveCoupon(client: SalesQueryClient, context: SalesContext, input: CouponInput, couponId?: string | null): Promise<{ coupon: Coupon }>;
export function setCouponActive(client: SalesQueryClient, context: SalesContext, couponId: string, active: boolean): Promise<{ coupon: Coupon }>;
export function normaliseCouponCode(code: unknown): string;
export function couponDiscount(client: SalesQueryClient, context: SalesContext, code: string | null | undefined, input: { value: number; partyId?: string | null;
  documentDate?: string | null; orderId?: string | null; carried?: boolean }): Promise<{ coupon: Coupon; amount: number } | null>;
export type RecurringSchedule = { id: string; orderId: string; intervalMonths: 1 | 3 | 6 | 12; intervalLabel: string; dayOfMonth: number; startDate: string; endDate: string | null;
  nextRunDate: string | null; makes: "order" | "invoice"; autoSend: boolean; status: "active" | "paused" | "ended"; runs: number; lastRunDate: string | null; lastError: string | null;
  orderNumber?: string; customerName?: string | null; grandTotal?: number };
export type RecurringRun = { runDate: string; orderId: string | null; orderNumber: string | null; invoiceId: string | null; invoiceNumber: string | null; error: string | null };
export type RecurringScheduleInput = { intervalMonths: number; dayOfMonth: number; startDate: string; endDate?: string | null; makes: "order" | "invoice"; autoSend?: boolean };
export type SalesOrderSupply = { sequence: number; itemId: string | null; itemName: string | null; route: "buy" | "make"; quantity: number;
  documentType: "purchase_indent" | "purchase_order" | "manufacturing_order" | null; documentId: string | null; documentNumber: string | null; error: string | null; at: string };
export const EXPORTABLE_LISTS: readonly string[];
export function exportSalesList(client: SalesQueryClient, context: SalesContext, kind: "invoices" | "credit-notes" | "deliveries" | "returns" | "payments",
  filters?: Record<string, unknown>): Promise<{ csv: string; fileName: string; rows: number }>;
export type FieldDay = { date: string; beats: Array<{ id: string; code: string; name: string }>;
  retailers: Array<{ id: string; name: string; number: string | null; phone: string | null; beatId: string | null; due: number; orderedToday: boolean;
    lastOrder: Array<{ itemId: string; quantity: number; uomId: string | null }> }>;
  products: Array<{ id: string; code: string; name: string; uomId: string | null; unit: string | null; price: number | null; mrp: number | null }> };
export function getFieldDay(client: SalesQueryClient, context: SalesContext, options?: { date?: string; allBeats?: boolean }): Promise<FieldDay>;
export function submitFieldOrder(client: SalesQueryClient, context: SalesContext, input: { partyId: string; lines: Array<{ itemId: string; quantity: number; uomId?: string }>;
  idempotencyKey: string; note?: string; orderDate?: string }): Promise<{ orderId: string; orderNumber: string; total: number; confirmed: boolean; problems: string[];
  freeGoods: Array<{ name: string; quantity: number }>; replayed: boolean }>;
export function recordFieldCollection(client: SalesQueryClient, context: SalesContext, input: { partyId: string; amount: number; method: "cash" | "cheque" | "upi";
  chequeNumber?: string; chequeDate?: string; draweeBank?: string; reference?: string; idempotencyKey: string }): Promise<{ receiptNumber: string | null; postDated: boolean;
  amount: number; applied: number; advance: number; whatsappText: string; whatsappUrl: string; replayed: boolean }>;
export function getFieldSummary(client: SalesQueryClient, context: SalesContext, options?: { date?: string }): Promise<{ date: string; orders: { count: number; total: number };
  collected: { total: number; byMethod: Array<{ method: string; label: string; count: number; total: number }> }; retailers: { onBeat: number; seen: number } }>;
export type CustomerPortalView = { signedIn: false; company: string } | { signedIn: true; company: string; email: string; customers: string[]; owed: { due: number; overdue: number };
  quotations: Array<{ number: string; date: string | null; validUntil: string | null; status: string; currencyCode: string; total: number; url: string }>;
  orders: Array<{ number: string; date: string | null; yourPo: string | null; status: string; currencyCode: string; total: number }>;
  invoices: Array<{ number: string; date: string | null; dueDate: string | null; currencyCode: string; total: number; due: number; overdue: boolean; url: string }> };
export function getCustomerPortal(client: SalesQueryClient, context: SalesContext, env?: Record<string, string | undefined>): Promise<{ portal: { on: boolean; url: string | null } }>;
export function setCustomerPortal(client: SalesQueryClient, context: SalesContext, input: { on?: boolean; newAddress?: boolean }, env?: Record<string, string | undefined>):
  Promise<{ portal: { on: boolean; url: string | null } }>;
export function requestPortalCode(client: SalesQueryClient, key: string, input: { email: string }, options?: { env?: Record<string, string | undefined>;
  deliver?: (email: string, code: string) => Promise<void> }): Promise<{ sent: true } | null>;
export function verifyPortalCode(client: SalesQueryClient, key: string, input: { email: string; code: string }): Promise<{ token: string; maxAgeSeconds: number } | null>;
export function signOutOfPortal(client: SalesQueryClient, key: string, token: string | null | undefined): Promise<{ signedOut: true }>;
export function loadCustomerPortal(client: SalesQueryClient, key: string, token: string | null | undefined, env?: Record<string, string | undefined>): Promise<CustomerPortalView | null>;
export type PaymentGateway = { provider: "razorpay"; keyId: string; mode: "live" | "test"; active: boolean; bankAccountId: string | null; webhookUrl: string; updatedAt: string };
type GatewayOptions = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch };
export function getPaymentGateway(client: SalesQueryClient, context: SalesContext, env?: Record<string, string | undefined>): Promise<{ gateway: PaymentGateway | null }>;
export function savePaymentGateway(client: SalesQueryClient, context: SalesContext, input: { keyId: string; keySecret?: string; webhookSecret?: string; bankAccountId?: string | null;
  active?: boolean }, env?: Record<string, string | undefined>): Promise<{ gateway: PaymentGateway }>;
export function gatewayOn(client: SalesQueryClient, organizationId: string): Promise<boolean>;
export function startLinkPayment(client: SalesQueryClient, token: string, options?: GatewayOptions): Promise<{ keyId: string; orderId: string; amount: number; currency: string;
  name: string; description: string } | null>;
export function confirmLinkPayment(client: SalesQueryClient, token: string, input: { orderId: string; paymentId: string; signature: string }, options?: GatewayOptions):
  Promise<{ receiptId: string; replayed: boolean } | null>;
export function receiveGatewayWebhook(client: SalesQueryClient, organizationId: string, rawBody: string, signature: string, env?: Record<string, string | undefined>):
  Promise<{ receiptId?: string; replayed?: boolean; ignored?: boolean }>;
export type SalesDocumentEmail = { direction: "in" | "out"; sender: string | null; recipients: string | null; subject: string | null; body: string | null; at: string };
export function getDocumentConversation(client: SalesQueryClient, context: SalesContext, type: "sales.quotation" | "sales.order" | "sales.invoice" | "sales.credit_note", id: string):
  Promise<{ contact: { name: string | null; phone: string | null; email: string | null } | null; emails: SalesDocumentEmail[] }>;
export function listDocumentEmails(client: SalesQueryClient, context: SalesContext, type: "sales.quotation" | "sales.order" | "sales.invoice" | "sales.credit_note", id: string): Promise<SalesDocumentEmail[]>;
export function getSalesOrderSupply(client: SalesQueryClient, context: SalesContext, orderId: string): Promise<SalesOrderSupply[]>;
export function addMonthsOnDay(from: string, months: number, dayOfMonth: number): string;
export function getRecurringSchedule(client: SalesQueryClient, context: SalesContext, orderId: string): Promise<{ schedule: RecurringSchedule | null; runs: RecurringRun[] }>;
export function listRecurringSchedules(client: SalesQueryClient, context: SalesContext): Promise<{ schedules: RecurringSchedule[] }>;
export function saveRecurringSchedule(client: SalesQueryClient, context: SalesContext, orderId: string, input: RecurringScheduleInput): Promise<{ schedule: RecurringSchedule }>;
export function setRecurringScheduleStatus(client: SalesQueryClient, context: SalesContext, scheduleId: string, action: "pause" | "resume" | "end"): Promise<{ schedule: RecurringSchedule }>;
export function runRecurringSchedules(client: SalesQueryClient, systemContext: { organizationId: string }, options?: { today?: string;
  renderPdf?: (context: SalesContext, invoiceId: string) => Promise<{ fileName: string; content: Buffer }>; afterFinal?: (context: SalesContext, invoiceId: string) => Promise<unknown> }): Promise<{ ran: number; failed: number }>;

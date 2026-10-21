export type SalesQueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type SalesContext = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
export class SalesError extends Error { readonly status: number; readonly code: string; constructor(status: number, message: string, code?: string); }
export function previewSalesDocument(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, options?: { order?: boolean; allowMissingPrice?: boolean; preview?: boolean; carryQuotedPrices?: boolean }): Promise<any>;
export function getSalesReport(client: SalesQueryClient, context: SalesContext, key: string): Promise<any[]>;
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
export function sendDocumentOnWhatsApp(client: SalesQueryClient, context: SalesContext, input: { kind: "quotation" | "proforma" | "order" | "invoice" | "credit_note"; id: string; phone?: string; body?: string; idempotencyKey?: string }): Promise<{ phone: string; body: string; link: string }>;

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

export type SalesQueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type SalesContext = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
export class SalesError extends Error { readonly status: number; readonly code: string; constructor(status: number, message: string, code?: string); }
export function previewSalesDocument(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, options?: { order?: boolean; allowMissingPrice?: boolean; preview?: boolean; carryQuotedPrices?: boolean }): Promise<any>;
export function getSalesReport(client: SalesQueryClient, context: SalesContext, key: string): Promise<any[]>;
export function getSalesOptions(client: SalesQueryClient, context: SalesContext, opportunityId?: string | null, partyId?: string | null): Promise<any>;

export function accrueSalesCommission(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;

export function getSalesSettings(client: SalesQueryClient, context: SalesContext): Promise<Record<string, any>>;
export function listSalesSettingsWarehouses(client: SalesQueryClient, context: SalesContext): Promise<Array<{ id: string; code: string; name: string }>>;
export function updateSalesSettings(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<Record<string, any>>;

export * from "./price-lists/index.js";

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

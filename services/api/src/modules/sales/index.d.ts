export type SalesQueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type SalesContext = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
export class SalesError extends Error { readonly status: number; readonly code: string; constructor(status: number, message: string, code?: string); }
export function previewSalesDocument(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, options?: { order?: boolean; allowMissingPrice?: boolean; preview?: boolean; carryQuotedPrices?: boolean }): Promise<any>;
export function createSalesOrder(client: SalesQueryClient, context: SalesContext, input: Record<string, any>): Promise<any>;
export function listSalesOrders(client: SalesQueryClient, context: SalesContext, filters?: Record<string, any>): Promise<any[]>;
export function getSalesOrder(client: SalesQueryClient, context: SalesContext, id: string): Promise<any>;
export function amendSalesOrder(client: SalesQueryClient, context: SalesContext, id: string, input: Record<string, any>): Promise<any>;
export function approveSalesOrderAmendment(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  orderVersionId: string,
  previousVersionId: string,
  resumeStatus: "confirmed" | "on_hold",
): Promise<any>;
export function rejectSalesOrderAmendment(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  orderVersionId: string,
  previousVersionId: string,
  resumeStatus: "confirmed" | "on_hold",
): Promise<any>;
export function completeFulfillmentRequest(client: SalesQueryClient, context: SalesContext, requestId: string, input?: Record<string, any>): Promise<any>;
export function submitSalesOrder(client: SalesQueryClient, context: SalesContext, id: string, assignedTo?: string | null): Promise<any>;
export function approveSalesOrder(client: SalesQueryClient, context: SalesContext, orderId: string, orderVersionId: string): Promise<any>;
export function rejectSalesOrderApproval(client: SalesQueryClient, context: SalesContext, orderId: string, note?: string | null): Promise<void>;
export function confirmSalesOrder(client: SalesQueryClient, context: SalesContext, id: string, options?: Record<string, any>): Promise<any>;
export function placeOrderHold(client: SalesQueryClient, context: SalesContext, id: string, input: Record<string, any>): Promise<any>;
export function releaseOrderHold(client: SalesQueryClient, context: SalesContext, id: string, input: Record<string, any>): Promise<any>;
export function cancelSalesOrder(client: SalesQueryClient, context: SalesContext, id: string, reason: string): Promise<any>;
export function createFulfillmentRequest(client: SalesQueryClient, context: SalesContext, id: string, idempotencyKey: string): Promise<any>;
export function createInvoiceRequest(client: SalesQueryClient, context: SalesContext, id: string, input: Record<string, any>): Promise<any>;
export function getSalesDashboard(client: SalesQueryClient, context: SalesContext): Promise<any>;
export function getSalesReport(client: SalesQueryClient, context: SalesContext, key: string): Promise<any[]>;
export function getSalesOptions(client: SalesQueryClient, context: SalesContext, opportunityId?: string | null, partyId?: string | null): Promise<any>;

export function listSalesPass1Operations(client: SalesQueryClient, context: SalesContext, options?: { kind?: string; limit?: number }): Promise<any[]>;
export function requestSalesCreditAdjustment(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function accrueSalesCommission(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function listSalesPass1Options(client: SalesQueryClient, context: SalesContext): Promise<Record<string, any[]>>;
export function getSalesOrderLineReservationContext(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;

export function getSalesSettings(client: SalesQueryClient, context: SalesContext): Promise<Record<string, any>>;
export function updateSalesSettings(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<Record<string, any>>;

export * from "./price-lists/index.js";

export * from "./quotations/index.js";
export const DISCOUNT_PERMISSIONS: Readonly<Record<"applyLine" | "applyDocument" | "aboveLimit" | "overrideLimit" | "manageSettings", string>>;
export const DISCOUNT_REASONS: ReadonlyArray<{ code: string; label: string }>;

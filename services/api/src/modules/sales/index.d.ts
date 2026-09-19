export type SalesQueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export type SalesContext = { organizationId: string; userId: string | null; activeCompanyId: string | null; activeBranchId: string | null; allowAllCompanies: boolean; permissions: string[]; roleSlugs: string[] };
export class SalesError extends Error { readonly status: number; readonly code: string; constructor(status: number, message: string, code?: string); }
export function previewSalesDocument(client: SalesQueryClient, context: SalesContext, input: Record<string, any>, options?: { order?: boolean }): Promise<any>;
export function createQuotation(client: SalesQueryClient, context: SalesContext, input: Record<string, any>): Promise<any>;
export function reviseQuotation(client: SalesQueryClient, context: SalesContext, id: string, input: Record<string, any>): Promise<any>;
export function listQuotations(client: SalesQueryClient, context: SalesContext, filters?: Record<string, any>): Promise<any[]>;
export function getQuotation(client: SalesQueryClient, context: SalesContext, id: string, publicView?: boolean): Promise<any>;
export function submitQuotation(client: SalesQueryClient, context: SalesContext, id: string, assignedTo?: string | null): Promise<any>;
export function approveQuotation(client: SalesQueryClient, context: SalesContext, quotationId: string, quotationVersionId: string): Promise<any>;
export function rejectQuotationApproval(client: SalesQueryClient, context: SalesContext, quotationId: string): Promise<void>;
export function sendQuotation(client: SalesQueryClient, context: SalesContext, id: string, expiresInDays?: number): Promise<any>;
export function resolvePublicQuoteToken(client: SalesQueryClient, context: SalesContext, tokenHash: string, trackView?: boolean): Promise<any>;
export function recordPublicQuoteDecision(client: SalesQueryClient, context: SalesContext, tokenHash: string, input: Record<string, any>, metadata?: Record<string, any>): Promise<any>;
export function scanExpiredQuotations(client: SalesQueryClient, context: SalesContext): Promise<{ scanned: number; expired: number }>;
export function createSalesOrder(client: SalesQueryClient, context: SalesContext, input: Record<string, any>): Promise<any>;
export function convertQuotationToOrder(client: SalesQueryClient, context: SalesContext, id: string): Promise<any>;
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
export function rejectSalesOrderApproval(client: SalesQueryClient, context: SalesContext, orderId: string): Promise<void>;
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
export function recordSalesAdvancePayment(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function requestSalesCreditAdjustment(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function createSalesDropShipRequest(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function createSalesCommissionRule(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function accrueSalesCommission(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function upsertSalesPriceListItem(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function upsertSalesCustomerPrice(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function listSalesPass1Options(client: SalesQueryClient, context: SalesContext): Promise<Record<string, any[]>>;
export function listSalesPriceLists(client: SalesQueryClient, context: SalesContext): Promise<{ rows: Record<string, any>[] }>;
export function createSalesPriceList(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;
export function listSalesPriceListItems(client: SalesQueryClient, context: SalesContext, priceListId: string, options?: { limit?: number; offset?: number }): Promise<{ priceList: Record<string, any>; rows: Record<string, any>[]; total: number }>;
export function listSalesCustomerPrices(client: SalesQueryClient, context: SalesContext, options?: { partyId?: string; limit?: number; offset?: number }): Promise<{ rows: Record<string, any>[]; total: number }>;
export function listSalesPricingOptions(client: SalesQueryClient, context: SalesContext): Promise<{ items: Record<string, any>[]; customers: Record<string, any>[]; uoms: Record<string, any>[]; variants: Record<string, any>[] }>;
export function deactivateSalesPriceListItem(client: SalesQueryClient, context: SalesContext, priceListItemId: string): Promise<any>;
export function deactivateSalesPricingRule(client: SalesQueryClient, context: SalesContext, pricingRuleId: string): Promise<any>;
export function getSalesOrderLineReservationContext(client: SalesQueryClient, context: SalesContext, input?: Record<string, any>): Promise<any>;

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export class SalesOrderError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const SALES_ORDER_PERMISSIONS: Readonly<Record<string, string>>;
export const SALES_ORDER_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const SALES_ORDER_STATUS: Readonly<Record<"draft" | "confirmed" | "cancelled" | "closed", string>>;
export const SALES_ORDER_CANCEL_REASONS: ReadonlyArray<{ code: string; label: string }>;
export const SALES_ORDER_FILE_ENTITY: "sales.order";

export function createSalesOrder(client: QueryClient, context: Context, input: Record<string, any>): Promise<{ id: string; sales_order_number: string; salesOrderNumber: string; currentVersionId: string; duplicatePurchaseOrders: any[]; replayed: boolean }>;
export function updateSalesOrder(client: QueryClient, context: Context, orderId: string, input: Record<string, any>): Promise<{ id: string; currentVersionId: string; versionNumber: number; duplicatePurchaseOrders: any[] }>;
export function previewSalesOrder(client: QueryClient, context: Context, orderId: string, input: Record<string, any>): Promise<any>;
export function getSalesOrder(client: QueryClient, context: Context, orderId: string): Promise<any>;
export function listSalesOrders(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<{ rows: any[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; capabilities: Record<string, boolean> }>;
export function getSalesOrderDefaults(client: QueryClient, context: Context, input?: { partyId?: string | null }): Promise<Record<string, any>>;
export function exportSalesOrders(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<{ csv: string; fileName: string; rows: number }>;
export function addSalesOrderNote(client: QueryClient, context: Context, orderId: string, input: { note: string }): Promise<{ added: true }>;

export function reopenSalesOrder(client: QueryClient, context: Context, orderId: string, input: { reason: string }): Promise<{ orderId: string; status: "draft"; reservationsReleased: number }>;
export function cancelSalesOrder(client: QueryClient, context: Context, orderId: string, input?: { reasonCode?: string; reason?: string }): Promise<{ orderId: string; status: "cancelled"; changed: boolean; sourceOpportunityId: string | null }>;
export function cancelSalesOrderRemaining(client: QueryClient, context: Context, orderId: string,
  input: { lines?: Array<{ salesOrderLineId: string; quantity?: number | string | null }>; reasonCode?: string; reason?: string }): Promise<any>;


export function refreshSalesOrderProgress(client: QueryClient, organizationId: string, orderId: string, actorUserId?: string | null): Promise<any>;


export function prepareSalesOrderFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listSalesOrderFiles(client: QueryClient, context: Context, orderId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadSalesOrderFile(client: QueryClient, context: Context, orderId: string, input: { prepared: any }, options?: Record<string, any>): Promise<any>;
export function removeSalesOrderFile(client: QueryClient, context: Context, orderId: string, fileId: string): Promise<{ removed: true }>;
export function readSalesOrderFile(client: QueryClient, context: Context, orderId: string, fileId: string, options?: Record<string, any>): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;

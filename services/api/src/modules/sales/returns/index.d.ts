type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type FileOptions = Record<string, unknown>;

export type SalesReturnStatus = "draft" | "received" | "cancelled";
export class SalesReturnError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const SALES_RETURN_STATUS: Readonly<Record<SalesReturnStatus, SalesReturnStatus>>;
export const SALES_RETURN_PERMISSIONS: Readonly<Record<string, string>>;
export const SALES_RETURN_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const SALES_RETURN_REASONS: ReadonlyArray<{ code: string; label: string }>;
export const SALES_RETURN_DISPOSITIONS: ReadonlyArray<{ code: string; label: string; sellable: boolean }>;
export const SALES_RETURN_FILE_ENTITY: "sales.return";

type ReturnLineInput = Array<{ deliveryLineId: string; quantity: number | string; disposition?: string; reasonCode?: string | null }>;

export function getReturnProposal(client: QueryClient, context: Context, deliveryId: string): Promise<any>;
export function createReturnFromDelivery(client: QueryClient, context: Context, deliveryId: string, input: {
  idempotencyKey: string; lines: ReturnLineInput; reasonCode: string; reasonNote?: string | null; disposition?: string; warehouseId?: string | null; returnDate?: string | null;
  customerNotes?: string | null; internalNotes?: string | null;
}): Promise<{ returnId: string; returnNumber: string; status: SalesReturnStatus; replayed: boolean; warnings: Array<{ item: string; message: string }> }>;
export function updateDraftReturn(client: QueryClient, context: Context, returnId: string, input: {
  expectedVersion?: number | null; lines?: ReturnLineInput; reasonCode?: string; reasonNote?: string | null; warehouseId?: string; returnDate?: string; customerNotes?: string | null; internalNotes?: string | null;
}): Promise<{ returnId: string; version: number; changed: boolean; changes?: any[]; warnings: any[] }>;
export function getSalesReturn(client: QueryClient, context: Context, returnId: string): Promise<any>;
export function listSalesReturns(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<{
  rows: any[]; total: number; limit: number; offset: number; views: ReadonlyArray<{ key: string; label: string }>; reasons: ReadonlyArray<{ code: string; label: string }>; capabilities: Record<string, boolean>;
}>;
export function receiveSalesReturn(client: QueryClient, context: Context, returnId: string, input?: { expectedVersion?: number | null }): Promise<{ returnId: string; returnNumber: string; status: SalesReturnStatus; replayed: boolean }>;
export function cancelDraftReturn(client: QueryClient, context: Context, returnId: string, input?: { reason?: string | null }): Promise<{ returnId: string; status: SalesReturnStatus; changed: boolean }>;
export function createCreditNoteFromReturn(client: QueryClient, context: Context, returnId: string, input: { idempotencyKey: string; reason?: string; internalNotes?: string; lines?: Array<{ returnLineId: string; quantity: number | string }> }): Promise<{
  creditNotes: Array<{ creditNoteId: string; creditNoteNumber: string; invoiceId: string }>; replayed: boolean;
}>;
export function getReturnNote(client: QueryClient, context: Context, returnId: string): Promise<any>;

export function prepareReturnFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listReturnFiles(client: QueryClient, context: Context, returnId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadReturnFile(client: QueryClient, context: Context, returnId: string, input: { prepared: unknown }, options?: FileOptions): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
export function removeReturnFile(client: QueryClient, context: Context, returnId: string, fileId: string): Promise<{ removed: true }>;
export function readReturnFile(client: QueryClient, context: Context, returnId: string, fileId: string, options?: FileOptions): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;

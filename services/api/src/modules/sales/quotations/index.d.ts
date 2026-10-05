type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export class QuotationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const QUOTATION_PERMISSIONS: Readonly<Record<string, string>>;
export const QUOTATION_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const QUOTATION_STATUS: Readonly<Record<string, string>>;
export const QUOTATION_STATUS_LABELS: Readonly<Record<string, string>>;
export const QUOTATION_FILE_ENTITY: "sales.quotation";

export function createQuotation(client: QueryClient, context: Context, input: Record<string, any>): Promise<{ id: string; quotation_number: string; quotationNumber: string; currentVersionId: string; replayed: boolean }>;
export function updateQuotation(client: QueryClient, context: Context, quotationId: string, input: Record<string, any>): Promise<{ id: string; currentVersionId: string; versionNumber: number }>;
export function getQuotation(client: QueryClient, context: Context, quotationId: string): Promise<any>;
export function listQuotations(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<{ rows: any[]; total: number; limit: number; offset: number; views: Array<{ key: string; label: string }>; capabilities: Record<string, boolean> }>;
export function getQuotationDefaults(client: QueryClient, context: Context, input?: { partyId?: string | null }): Promise<Record<string, any>>;
export function duplicateQuotation(client: QueryClient, context: Context, quotationId: string, input?: { idempotencyKey?: string }): Promise<any>;
export function createQuotationRevision(client: QueryClient, context: Context, quotationId: string, input: { reason: string; idempotencyKey?: string }): Promise<{ id: string; quotationNumber: string; replayed: boolean }>;
export function exportQuotations(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<{ csv: string; fileName: string; rows: number }>;
export function addQuotationNote(client: QueryClient, context: Context, quotationId: string, input: { note: string }): Promise<{ added: true }>;

export function confirmQuotation(client: QueryClient, context: Context, quotationId: string, input?: { expectedVersionNumber?: number; assignedTo?: string | null }): Promise<any>;
export function approveQuotation(client: QueryClient, context: Context, quotationId: string, quotationVersionId?: string | null): Promise<any>;
export function rejectQuotationApproval(client: QueryClient, context: Context, quotationId: string, note?: string | null): Promise<any>;
export function markQuotationSent(client: QueryClient, context: Context, quotationId: string, input?: { recipient?: string; note?: string }): Promise<{ quotationId: string; status: "sent" }>;
export function emailQuotation(client: QueryClient, context: Context, quotationId: string, input: { to: string; cc?: string; subject?: string; message?: string },
  attachment: { fileName: string; content: Uint8Array } | null, env?: Record<string, string | undefined>): Promise<{ quotationId: string; status: "sent"; messageId: string | null }>;
export function recordQuotationDecision(client: QueryClient, context: Context, quotationId: string,
  input: { decision: "accepted" | "rejected"; reference?: string; notes?: string; customerName?: string }): Promise<{ quotationId: string; decision: "accepted" | "rejected"; changed: boolean }>;
export function cancelQuotation(client: QueryClient, context: Context, quotationId: string, input: { reason: string }): Promise<{ quotationId: string; status: "cancelled"; changed: boolean }>;
export function createSalesOrderFromQuotation(client: QueryClient, context: Context, quotationId: string, input?: Record<string, any>): Promise<{ orderId: string; orderNumber: string | null; idempotent: boolean }>;

export function prepareQuotationFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listQuotationFiles(client: QueryClient, context: Context, quotationId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadQuotationFile(client: QueryClient, context: Context, quotationId: string, input: { prepared: any }, options?: Record<string, any>): Promise<any>;
export function removeQuotationFile(client: QueryClient, context: Context, quotationId: string, fileId: string): Promise<{ removed: true }>;
export function readQuotationFile(client: QueryClient, context: Context, quotationId: string, fileId: string, options?: Record<string, any>): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;

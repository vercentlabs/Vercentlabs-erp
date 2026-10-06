type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type FileOptions = Record<string, unknown>;

export type SalesInvoiceStatus = "draft" | "posted" | "reversed" | "cancelled";

export class SalesInvoiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const SALES_INVOICE_PERMISSIONS: Readonly<Record<string, string>>;
export const SALES_INVOICE_STATUS: Readonly<Record<SalesInvoiceStatus, SalesInvoiceStatus>>;
export const SALES_INVOICE_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const SALES_INVOICE_FILE_ENTITY: "sales.invoice";

type QuantityLines = Array<{ salesOrderLineId: string; quantity: number | string }>;
type Created = { invoiceId: string; invoiceNumber: string; status: SalesInvoiceStatus; replayed: boolean };

export function getInvoiceProposal(client: QueryClient, context: Context, orderId: string): Promise<{ orderId: string; basis: "ordered" | "delivered"; canInvoice: boolean; lines: any[] }>;
export function createInvoiceFromSalesOrder(client: QueryClient, context: Context, orderId: string,
  input: { idempotencyKey: string; lines?: QuantityLines; invoiceDate?: string | null; postingDate?: string | null; customerNotes?: string | null; internalNotes?: string | null },
): Promise<Created>;
export function createInvoiceFromDelivery(client: QueryClient, context: Context, deliveryId: string,
  input: { idempotencyKey: string; lines?: Array<{ deliveryLineId: string; quantity: number | string }>; invoiceDate?: string | null; customerNotes?: string | null; internalNotes?: string | null },
): Promise<Created & { deliveryId: string }>;
export function updateDraftInvoice(client: QueryClient, context: Context, invoiceId: string,
  input: {
    expectedVersion?: number | null; lines?: QuantityLines; invoiceDate?: string | null; postingDate?: string | null; paymentTermId?: string; paymentTermsNote?: string | null;
    dueDate?: string | null; dueDateReason?: string | null; contactId?: string | null;
    customerNotes?: string | null; internalNotes?: string | null; recalculateTax?: boolean;
  },
): Promise<{ invoiceId: string; version: number; changed: boolean; changes?: any[] }>;
export function getSalesInvoice(client: QueryClient, context: Context, invoiceId: string): Promise<{
  invoice: Record<string, any>; lines: any[]; taxSummary: any[]; receipts: any[]; credits: any[]; creditNotes: any[]; deliveries: any[]; sends: any[]; events: any[];
  sentChannels: ReadonlyArray<{ code: string; label: string }>; actions: Record<string, boolean>;
}>;
export function listSalesInvoices(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<{
  rows: any[]; total: number; limit: number; offset: number; views: ReadonlyArray<{ key: string; label: string }>; capabilities: Record<string, boolean>;
}>;

export function validateInvoiceForPosting(client: QueryClient, context: Context, invoiceId: string): Promise<{ ready: boolean; problems: Array<{ code: string; message: string }>; taxDifferences: any[] }>;
export function postSalesInvoice(client: QueryClient, context: Context, invoiceId: string, input?: { expectedVersion?: number | null }): Promise<{
  invoiceId: string; invoiceNumber: string; status: SalesInvoiceStatus; replayed: boolean; awaitingApproval?: boolean;
}>;
export function changePostedInvoiceDueDate(client: QueryClient, context: Context, invoiceId: string, input: { dueDate: string; reason: string }): Promise<{ invoiceId: string; dueDate: string; changed: boolean }>;
export function cancelDraftInvoice(client: QueryClient, context: Context, invoiceId: string, input?: { reason?: string | null }): Promise<{ invoiceId: string; status: SalesInvoiceStatus; changed: boolean }>;
export function reverseSalesInvoice(client: QueryClient, context: Context, invoiceId: string, input: { reason: string }): Promise<{ invoiceId: string; status: SalesInvoiceStatus; changed: boolean }>;

export function sendSalesInvoice(client: QueryClient, context: Context, invoiceId: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string },
  attachment: { fileName: string; content: Uint8Array } | null, env?: Record<string, string | undefined>): Promise<{ invoiceId: string; sentTo: string; messageId: string | null; replayed: boolean }>;
export function markSalesInvoiceSent(client: QueryClient, context: Context, invoiceId: string, input: { channel: string; recipient?: string; note?: string; sentAt?: string; idempotencyKey?: string }): Promise<{ invoiceId: string; replayed: boolean }>;
export function getSalesInvoiceDocument(client: QueryClient, context: Context, invoiceId: string): Promise<any>;

export function prepareInvoiceFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listInvoiceFiles(client: QueryClient, context: Context, invoiceId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadInvoiceFile(client: QueryClient, context: Context, invoiceId: string, input: { prepared: unknown }, options?: FileOptions): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
export function removeInvoiceFile(client: QueryClient, context: Context, invoiceId: string, fileId: string): Promise<{ removed: true }>;
export function readInvoiceFile(client: QueryClient, context: Context, invoiceId: string, fileId: string, options?: FileOptions): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;

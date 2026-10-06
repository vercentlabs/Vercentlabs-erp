type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type FileOptions = Record<string, unknown>;

export type SalesCreditNoteStatus = "draft" | "posted" | "reversed" | "cancelled";
export class SalesCreditNoteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const SALES_CREDIT_NOTE_STATUS: Readonly<Record<SalesCreditNoteStatus, SalesCreditNoteStatus>>;
export const SALES_CREDIT_NOTE_PERMISSIONS: Readonly<Record<string, string>>;
export const SALES_CREDIT_NOTE_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const SALES_CREDIT_REASONS: ReadonlyArray<{ code: string; label: string }>;
export const SALES_CREDIT_NOTE_FILE_ENTITY: "sales.credit_note";

type CreditLineInput = Array<{ invoiceLineId: string; creditType: "quantity" | "amount"; quantity?: number | string | null; amount?: number | string | null }>;
type Warning = { item: string; message: string };

export function getCreditNoteProposal(client: QueryClient, context: Context, invoiceId: string): Promise<any>;
export function creditedTotals(client: QueryClient, organizationId: string, invoiceId: string): Promise<{ posted: number; drafts: number }>;
export function createCreditNote(client: QueryClient, context: Context, invoiceId: string, input: {
  idempotencyKey: string; reasonCode: string; reasonNote?: string | null; creditDate?: string | null; customerNotes?: string | null; internalNotes?: string | null; lines: CreditLineInput;
}): Promise<{ creditNoteId: string; creditNoteNumber: string; status: SalesCreditNoteStatus; replayed: boolean; warnings: Warning[] }>;
export function updateDraftCreditNote(client: QueryClient, context: Context, creditNoteId: string, input: {
  expectedVersion?: number | null; lines?: CreditLineInput; reasonCode?: string; reasonNote?: string | null; creditDate?: string; customerNotes?: string | null; internalNotes?: string | null;
}): Promise<{ creditNoteId: string; version: number; changed: boolean; changes?: any[]; warnings: Warning[] }>;
export function getCreditNote(client: QueryClient, context: Context, creditNoteId: string): Promise<any>;
export function listCreditNotes(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<{
  rows: any[]; total: number; limit: number; offset: number; views: ReadonlyArray<{ key: string; label: string }>; reasons: ReadonlyArray<{ code: string; label: string }>; capabilities: Record<string, boolean>;
}>;
export function validateCreditNoteForPosting(client: QueryClient, context: Context, creditNoteId: string): Promise<{ ready: boolean; problems: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }> }>;
export function postCreditNote(client: QueryClient, context: Context, creditNoteId: string, input?: { expectedVersion?: number | null }): Promise<{
  creditNoteId: string; creditNoteNumber: string; status: SalesCreditNoteStatus; replayed: boolean; awaitingApproval?: boolean; applied?: number; unapplied?: number;
}>;
export function cancelDraftCreditNote(client: QueryClient, context: Context, creditNoteId: string, input?: { reason?: string | null }): Promise<{ creditNoteId: string; status: SalesCreditNoteStatus; changed: boolean }>;
export function reverseCreditNote(client: QueryClient, context: Context, creditNoteId: string, input: { reason: string }): Promise<{
  creditNoteId: string; status: SalesCreditNoteStatus; changed: boolean; unapplied?: Array<{ invoiceId: string; invoiceNumber: string; amount: string }>;
}>;
export function sendCreditNote(client: QueryClient, context: Context, creditNoteId: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string },
  attachment: { fileName: string; content: Uint8Array } | null, env?: Record<string, string | undefined>): Promise<{ creditNoteId: string; sentTo: string; messageId: string | null; replayed: boolean }>;
export function markCreditNoteSent(client: QueryClient, context: Context, creditNoteId: string, input: { channel: string; recipient?: string; note?: string; sentAt?: string; idempotencyKey?: string }): Promise<{ creditNoteId: string; replayed: boolean }>;
export function getCreditNoteDocument(client: QueryClient, context: Context, creditNoteId: string): Promise<any>;

export function prepareCreditNoteFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listCreditNoteFiles(client: QueryClient, context: Context, creditNoteId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadCreditNoteFile(client: QueryClient, context: Context, creditNoteId: string, input: { prepared: unknown }, options?: FileOptions): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
export function removeCreditNoteFile(client: QueryClient, context: Context, creditNoteId: string, fileId: string): Promise<{ removed: true }>;
export function readCreditNoteFile(client: QueryClient, context: Context, creditNoteId: string, fileId: string, options?: FileOptions): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type FileOptions = Record<string, unknown>;

export type CustomerRefundStatus = "draft" | "posted" | "reversed" | "cancelled";
export type CustomerRefundSourceType = "credit_note" | "receipt";
export class CustomerRefundError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const CUSTOMER_REFUND_STATUS: Readonly<Record<CustomerRefundStatus, CustomerRefundStatus>>;
export const CUSTOMER_REFUND_PERMISSIONS: Readonly<Record<string, string>>;
export const CUSTOMER_REFUND_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const CUSTOMER_REFUND_REASONS: ReadonlyArray<{ code: string; label: string }>;
export const CUSTOMER_REFUND_METHODS: ReadonlyArray<{ code: string; label: string }>;
export const CUSTOMER_REFUND_FILE_ENTITY: "accounting.customer_refund";

type Check = { code: string; message: string; field?: string };
type RefundInput = {
  idempotencyKey: string; amount: number | string; refundDate?: string | null; reasonCode?: string | null; reasonNote?: string | null; paymentMethod?: string | null;
  bankAccountId?: string | null; externalReference?: string | null; customerNotes?: string | null; internalNotes?: string | null;
};
type Created = { refundId: string; refundNumber: string; status: CustomerRefundStatus; replayed: boolean; warnings: Check[] };

export function getRefundableCustomerCredit(client: QueryClient, context: Context, partyId: string): Promise<any>;
export function createCustomerRefund(client: QueryClient, context: Context, input: RefundInput & { sourceType: CustomerRefundSourceType; sourceId: string }): Promise<Created>;
export function createRefundFromCreditNote(client: QueryClient, context: Context, creditNoteId: string, input: RefundInput): Promise<Created>;
export function createRefundFromOverpayment(client: QueryClient, context: Context, receiptId: string, input: RefundInput): Promise<Created>;
export function updateDraftRefund(client: QueryClient, context: Context, refundId: string, input: Partial<Omit<RefundInput, "idempotencyKey">> & { expectedVersion?: number | null }): Promise<{
  refundId: string; version: number; changed: boolean; changes?: any[];
}>;
export function getCustomerRefund(client: QueryClient, context: Context, refundId: string): Promise<any>;
export function listCustomerRefunds(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<{
  rows: any[]; total: number; limit: number; offset: number; views: ReadonlyArray<{ key: string; label: string }>; reasons: ReadonlyArray<{ code: string; label: string }>;
  methods: ReadonlyArray<{ code: string; label: string }>; accounts: any[]; capabilities: Record<string, boolean>;
}>;
export function listRefundAccounts(client: QueryClient, context: Context, currencyCode?: string | null): Promise<any[]>;
export function validateRefundForPosting(client: QueryClient, context: Context, refundId: string): Promise<{ ready: boolean; problems: Check[]; warnings: Check[] }>;
export function postCustomerRefund(client: QueryClient, context: Context, refundId: string, input?: {
  expectedVersion?: number | null; bankAccountId?: string | null; paymentMethod?: string | null; externalReference?: string | null; refundDate?: string | null;
}): Promise<{ refundId: string; refundNumber: string; status: CustomerRefundStatus; replayed: boolean; creditLeft?: number }>;
export function cancelDraftRefund(client: QueryClient, context: Context, refundId: string, input?: { reason?: string | null }): Promise<{ refundId: string; status: CustomerRefundStatus; changed: boolean }>;
export function reverseCustomerRefund(client: QueryClient, context: Context, refundId: string, input: { reason: string; accountingDate?: string }): Promise<{
  refundId: string; status: CustomerRefundStatus; changed: boolean; creditRestored?: number; creditLeft?: number;
}>;
export function sendRefundConfirmation(client: QueryClient, context: Context, refundId: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string },
  attachment: { fileName: string; content: Uint8Array } | null, env?: Record<string, string | undefined>): Promise<{ refundId: string; sentTo: string; messageId: string | null; replayed: boolean }>;
export function markRefundConfirmationSent(client: QueryClient, context: Context, refundId: string, input: { channel: string; recipient?: string; note?: string; idempotencyKey?: string }): Promise<{ refundId: string; replayed: boolean }>;
export function getRefundVoucher(client: QueryClient, context: Context, refundId: string): Promise<any>;

export function prepareRefundFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listRefundFiles(client: QueryClient, context: Context, refundId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function uploadRefundFile(client: QueryClient, context: Context, refundId: string, input: { prepared: unknown }, options?: FileOptions): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
export function removeRefundFile(client: QueryClient, context: Context, refundId: string, fileId: string): Promise<{ removed: true }>;
export function readRefundFile(client: QueryClient, context: Context, refundId: string, fileId: string, options?: FileOptions): Promise<{ fileName: string; mimeType: string; body: Uint8Array }>;

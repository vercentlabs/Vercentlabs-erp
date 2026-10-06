type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export type PaymentTermCalculation = "due_on_receipt" | "net_days" | "custom";
export class PaymentTermError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const PAYMENT_TERM_CALCULATION: Readonly<{ dueOnReceipt: "due_on_receipt"; netDays: "net_days"; custom: "custom" }>;
export const PAYMENT_TERM_CALCULATION_TYPES: ReadonlyArray<{ code: PaymentTermCalculation; label: string }>;
export const PAYMENT_TERM_MAX_NET_DAYS: number;
export const PAYMENT_TERM_PERMISSIONS: Readonly<{ view: "payment_terms.view"; manage: "payment_terms.manage"; setDefault: "payment_terms.set_default" }>;

// The snapshot of its payment terms a document keeps.
export type PaymentTermSnapshot = {
  id: string | null; code: string | null; name: string | null; description: string | null; calculationType: PaymentTermCalculation; days: number | null; note: string | null;
  calculationLabel: string; summary: string;
};
export type PaymentTermRecord = {
  id: string; code: string; name: string; description: string | null; calculationType: PaymentTermCalculation; calculationLabel: string; days: number | null; salesEnabled: boolean;
  purchaseEnabled: boolean; isDefaultSales: boolean; status: "active" | "inactive"; customers: number; documents: number; inUse: boolean; createdAt: string; createdByName: string | null;
  updatedAt: string; updatedByName: string | null;
};
type TermInput = { name?: string; calculationType?: PaymentTermCalculation; days?: number | string | null; description?: string | null; salesEnabled?: boolean; purchaseEnabled?: boolean };

export function snapshotOfTerm(term: Record<string, any> | null | undefined, note?: string | null): Record<string, any>;
export function readTermSnapshot(snapshot: unknown): PaymentTermSnapshot | null;
// The due date under the terms in `snapshot` for a document dated `documentDate`; null when the terms set no date.
export function calculateDueDate(documentDate: string | Date, snapshot: unknown): string | null;
export function resolveDefaultPaymentTerm(client: QueryClient, organizationId: string, options?: { partyId?: string | null }): Promise<{ paymentTermId: string | null; source: "customer" | "company" | null }>;

export function listPaymentTerms(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<{
  rows: PaymentTermRecord[]; calculationTypes: ReadonlyArray<{ code: PaymentTermCalculation; label: string }>; capabilities: { manage: boolean; setDefault: boolean };
}>;
export function getPaymentTerm(client: QueryClient, context: Context, termId: string): Promise<{ term: PaymentTermRecord; events: any[] }>;
export function createPaymentTerm(client: QueryClient, context: Context, input: TermInput & { code: string; name: string; calculationType: PaymentTermCalculation }): Promise<PaymentTermRecord>;
export function updatePaymentTerm(client: QueryClient, context: Context, termId: string, input: TermInput): Promise<PaymentTermRecord>;
export function activatePaymentTerm(client: QueryClient, context: Context, termId: string): Promise<PaymentTermRecord>;
export function deactivatePaymentTerm(client: QueryClient, context: Context, termId: string): Promise<PaymentTermRecord>;
export function setDefaultSalesPaymentTerm(client: QueryClient, context: Context, termId: string | null): Promise<{ defaultPaymentTermId: string | null; changed: boolean }>;
export function salesTermSnapshot(client: QueryClient, organizationId: string, termId: string, note?: string | null): Promise<Record<string, any>>;
export function listSalesTermOptions(client: QueryClient, organizationId: string): Promise<any[]>;
export function purchaseTermSnapshot(client: QueryClient, organizationId: string, termId: string, note?: string | null): Promise<Record<string, any>>;
export function listPurchaseTermOptions(client: QueryClient, organizationId: string): Promise<any[]>;

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };

export type PaymentTermCalculation = "due_on_receipt" | "net_days" | "custom";
export type PaymentTermType = "immediate" | "net_days" | "invoice_receipt" | "end_of_month" | "fixed_day" | "installments" | "advance" | "custom";
export type PaymentTermRule = {
  sequence: number; percentage: string; basis: "invoice_date" | "invoice_received" | "posting_date"; kind: "days" | "end_of_month" | "fixed_day"; days: number; monthsOffset: number;
  dayOfMonth: number | null;
};
export class PaymentTermError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export class PaymentTermRuleError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}
type Choice<T extends string = string> = { code: T; label: string };
export const PAYMENT_TERM_CALCULATION: Readonly<{ dueOnReceipt: "due_on_receipt"; netDays: "net_days"; custom: "custom" }>;
export const PAYMENT_TERM_CALCULATION_TYPES: ReadonlyArray<Choice<PaymentTermCalculation>>;
export const PAYMENT_TERM_TYPES: ReadonlyArray<Choice<PaymentTermType>>;
export const PAYMENT_TERM_REFERENCE_BASES: ReadonlyArray<Choice>;
export const PAYMENT_TERM_RULE_KINDS: ReadonlyArray<Choice>;
export const PAYMENT_TERM_MAX_NET_DAYS: number;
export const PAYMENT_TERM_PERMISSIONS: Readonly<{ view: "payment_terms.view"; manage: "payment_terms.manage"; setDefault: "payment_terms.set_default" }>;

// The snapshot of its payment terms a document keeps.
export type PaymentTermSnapshot = {
  id: string | null; code: string | null; name: string | null; description: string | null; calculationType: PaymentTermCalculation; termType: PaymentTermType; days: number | null;
  version: number; rules: PaymentTermRule[]; advancePercentage: string | null; note: string | null; calculationLabel: string; termTypeLabel: string; summary: string;
  needsInvoiceReceivedDate: boolean;
};
export type PaymentTermRecord = {
  id: string; code: string; name: string; description: string | null; termType: PaymentTermType; termTypeLabel: string; calculationType: PaymentTermCalculation; calculationLabel: string;
  days: number | null; rules: PaymentTermRule[]; summary: string; advancePercentage: string | null; version: number; buyingRegistrationId: string | null; company: string;
  salesEnabled: boolean; purchaseEnabled: boolean; isDefaultSales: boolean; isDefaultPurchase: boolean; status: "active" | "inactive"; customers: number; suppliers: number; documents: number;
  inUse: boolean; createdAt: string; createdByName: string | null; updatedAt: string; updatedByName: string | null;
};
type DateInputs = { invoiceDate?: string | null; invoiceReceivedDate?: string | null; postingDate?: string | null };

export function snapshotOfTerm(term: Record<string, any> | null | undefined, rules?: unknown[] | null, note?: string | null): Record<string, any>;
export function readTermSnapshot(snapshot: unknown): PaymentTermSnapshot | null;
export function describePaymentTermRules(rules: unknown[]): string;
export function validatePaymentTermRules(rules: unknown[]): PaymentTermRule[];
export function validateInstallmentPercentages(rules: unknown[]): PaymentTermRule[];
export function dueDateForRule(rule: unknown, dates?: DateInputs): { dueDate: string | null; referenceDate: string | null; basis: string; missing: boolean };
export function generatePaymentSchedule(snapshot: unknown, options?: { total?: unknown; precision?: number; dates?: DateInputs }): Array<{
  sequence: number; percentage: string; amount: bigint; dueDate: string | null; referenceDate: string | null; basis: string; missing: boolean; rule: PaymentTermRule;
}> | null;
export function calculateInstallmentAmounts(snapshot: unknown, total: unknown, precision?: number): Array<{ sequence: number; percentage: string; amount: bigint }> | null;
// The due date under the terms in `snapshot` for a document dated `documentDate`; null when the terms set no date.
export function calculateDueDate(documentDate: string | Date, snapshot: unknown, dates?: DateInputs): string | null;
export function calculatePaymentDueDate(documentDate: string | Date, snapshot: unknown, dates?: DateInputs): string | null;
export function companyToday(client: QueryClient, organizationId: string): Promise<string>;
export function resolveDefaultPaymentTerm(client: QueryClient, organizationId: string, options?: { partyId?: string | null }): Promise<{ paymentTermId: string | null; source: "customer" | "company" | null }>;

type TermOptions = { termTypes: ReadonlyArray<Choice>; referenceBases: ReadonlyArray<Choice>; ruleKinds: ReadonlyArray<Choice>; calculationTypes: ReadonlyArray<Choice> };
export function listPaymentTerms(client: QueryClient, context: Context, filters?: Record<string, string | undefined>): Promise<TermOptions & {
  rows: PaymentTermRecord[]; registrations: Array<{ id: string; name: string }>; capabilities: { manage: boolean; setDefault: boolean };
}>;
export const getPaymentTerms: typeof listPaymentTerms;
export function getPaymentTerm(client: QueryClient, context: Context, termId: string): Promise<TermOptions & { term: PaymentTermRecord; events: any[]; versions: any[] }>;
export function createPaymentTerm(client: QueryClient, context: Context, input: Record<string, any>): Promise<PaymentTermRecord>;
export function updatePaymentTerm(client: QueryClient, context: Context, termId: string, input: Record<string, any>): Promise<PaymentTermRecord>;
export function versionPaymentTerm(client: QueryClient, context: Context, termId: string, input: Record<string, any>): Promise<PaymentTermRecord>;
export function activatePaymentTerm(client: QueryClient, context: Context, termId: string): Promise<PaymentTermRecord>;
export function deactivatePaymentTerm(client: QueryClient, context: Context, termId: string): Promise<PaymentTermRecord>;
export function setDefaultSalesPaymentTerm(client: QueryClient, context: Context, termId: string | null): Promise<{ defaultPaymentTermId: string | null; changed: boolean }>;
export function setDefaultPurchasePaymentTerm(client: QueryClient, context: Context, termId: string | null): Promise<{ defaultPaymentTermId: string | null; changed: boolean }>;
export function previewPaymentTerm(client: QueryClient, context: Context, input: Record<string, any>): Promise<{ summary: string; advancePercentage: string | null; lines: any[] }>;
export function salesTermSnapshot(client: QueryClient, organizationId: string, termId: string, note?: string | null): Promise<Record<string, any>>;
export function listSalesTermOptions(client: QueryClient, organizationId: string): Promise<any[]>;
export function purchaseTermSnapshot(client: QueryClient, organizationId: string, termId: string, note?: string | null, options?: { buyingRegistrationId?: string | null }): Promise<Record<string, any>>;
export function listPurchaseTermOptions(client: QueryClient, organizationId: string, options?: { buyingRegistrationId?: string | null }): Promise<any[]>;
export function getSupplierDefaultPaymentTerm(client: QueryClient, organizationId: string, supplierId: string | null): Promise<{ paymentTermId: string | null; source: "supplier" | "company" | null }>;

"use client";

// Payment Reconciliation (0108): the dashboard, the exception queue, settlement imports and payouts, matching, runs, merchant accounts and reports.
import { PosApiError } from "@/features/pos/shared/http";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/payments/reconciliation${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload.details);
  return payload;
}
const send = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const qs = (filters: Record<string, string | undefined>) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as Array<[string, string]>).toString();

export type Money = string | null;
export type Overview = {
  from: string; to: string;
  totals: { paid: Money; cashApplied: Money; providerMatched: Money; awaitingProvider: Money; awaitingSettlement: Money; settled: Money; unapplied: Money; awaitingBankMatch: Money;
    bankReceived: Money; settlementGross: Money; settlementFees: Money; settlementBatches: number; financePosted: number; financeFailed: number };
  byMethod: Array<{ method: string; count: number; amount: Money; settled: Money }>;
  exceptions: { open: number; exposure: Money; aging: Record<string, number>; byCode: Array<{ code: string; count: number; exposure: Money }>; recent: ReconException[] };
  runs: ReconRun[];
};
export type ReconException = {
  id: string; number: string; code: string; layer: string; outlet: string | null; merchant: string | null; sourceType: string; sourceId: string; references: Record<string, unknown>;
  currency: string; expected: Money; actual: Money; difference: Money; exposure: Money; status: string; assignedTo: string | null; evidence: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>; resolutionType: string | null; resolutionReference: string | null; resolutionNote: string | null; approvalRequestedBy: string | null;
  resolvedBy: string | null; resolvedAt: string | null; detectedAt: string; ageDays: number; version: number; matches?: ReconMatch[];
};
export type ReconMatch = { id: string; layer: string; internalType: string; internalId: string; externalType: string; externalId: string; amount: Money; matchType: string; rule: string;
  status: "PENDING_APPROVAL" | "ACTIVE" | "REVERSED"; reason: string | null; evidence: Array<Record<string, unknown>>; matchedAt: string; reversalReason: string | null; version: number };
export type ReconRun = { id: string; runType: string; status: string; processed: number; matched: number; exceptions: number; resolved: number; error: string | null; startedAt: string; finishedAt: string | null };
export type Settlement = {
  id: string; merchant: string | null; merchantAccountId: string; settlementId: string; settlementDate: string; currency: string; gross: Money; refunds: Money; fees: Money; feeTax: Money;
  chargebacks: Money; adjustments: Money; calculatedNet: Money; reportedNet: Money; payoutReference: string | null; status: string; bankMatched: Money; financeStatus: string; financeError: string | null;
};
export type SettlementLine = { id: string; number: number; type: string; transactionId: string | null; reference: string | null; gross: Money; fee: Money; feeTax: Money; net: Money; status: string;
  matches: Array<{ id: string; internalType: string; internalId: string; amount: string; rule: string; status: string }> };
export type SettlementDetail = Settlement & { lines: SettlementLine[]; bankMatches: Array<ReconMatch & { bankReference: string | null; bankDate: string; bankCredit: Money }> };
export type ImportPreview = { id: string; status: string; kind: string; fileName: string | null; lines: number; errorCount: number; errors: Array<{ row: number; message: string }>;
  batches: Array<{ settlementId: string; settlementDate: string; payoutReference: string | null; gross: string; refunds: string; fees: string; feeTax: string; chargebacks: string; adjustments: string;
    calculatedNet: string; reportedNet: string | null; netDifference: string | null; lines: number; duplicateLines: number }> };
export type MerchantAccount = { id: string; providerKey: string; merchantAccountReference: string; displayName: string; paymentMethods: string[]; currency: string; bankAccountId: string | null;
  bankAccount: string | null; settlementExpectedDays: number; status: string };
export type BankAccount = { id: string; code: string; bankName: string; accountName: string; currency: string };
export type Suggestion = { internalType: string; internalId: string; amount?: Money; remaining?: Money; method?: string; reference?: string | null; settlementId?: string; rule: string };

export const overview = (filters: Record<string, string | undefined> = {}) => call<{ overview: Overview }>(`/overview?${qs(filters)}`).then((result) => result.overview);
export const exceptions = (filters: Record<string, string | undefined> = {}) => call<{ total: number; rows: ReconException[] }>(`/exceptions?${qs(filters)}`);
export const exceptionDetail = (id: string) => call<{ exception: ReconException }>(`/exceptions/${id}`).then((result) => result.exception);
export const updateException = (id: string, input: { action: string; assignedTo?: string; note?: string; evidence?: { kind?: string; reference: string; note?: string }; expectedVersion?: number }) =>
  send<{ exception: ReconException }>(`/exceptions/${id}/update`, input).then((result) => result.exception);
export const resolveException = (id: string, input: { resolutionType: string; resolutionNote: string; resolutionReference?: string; evidence?: { kind?: string; reference: string }; expectedVersion?: number }) =>
  send<{ exception: ReconException }>(`/exceptions/${id}/resolve`, input).then((result) => result.exception);
export const startRun = (input: { runType?: string; idempotencyKey: string }) => send<{ run: ReconRun }>("/runs", input).then((result) => result.run);
export const settlements = (filters: Record<string, string | undefined> = {}) => call<{ settlements: Settlement[] }>(`/settlements?${qs(filters)}`).then((result) => result.settlements);
export const settlementDetail = (id: string) => call<{ settlement: SettlementDetail }>(`/settlements/${id}`).then((result) => result.settlement);
export const postToFinance = (id: string) => send<{ result: { posted: boolean; replayed: boolean; message?: string } }>(`/settlements/${id}/post-finance`).then((result) => result.result);
export const previewImport = (input: { merchantAccountId: string; fileName: string; contentBase64: string }) => send<{ import: ImportPreview }>("/settlements/import", input).then((result) => result.import);
export const commitImport = (id: string) => send<{ result: { import: ImportPreview; batches: Settlement[] } }>(`/settlements/import/${id}/commit`).then((result) => result.result);
export const matchBank = () => send<{ result: { matched: number } }>("/bank-matching", {}).then((result) => result.result);
export const suggest = (externalType: string, externalId: string) => send<{ suggestions: Suggestion[] }>("/matches/preview", { externalType, externalId }).then((result) => result.suggestions);
export const manualMatch = (input: { internalType: string; internalId: string; externalType: string; externalId: string; amount: string; reason: string; evidence: Array<{ kind?: string; reference: string }>; idempotencyKey: string }) =>
  send<{ match: ReconMatch }>("/matches", input).then((result) => result.match);
export const approveMatch = (id: string) => send<{ match: ReconMatch }>(`/matches/${id}/approve`, {}).then((result) => result.match);
export const reverseMatch = (id: string, reason: string) => send<{ match: ReconMatch }>(`/matches/${id}/reverse`, { reason }).then((result) => result.match);
export const merchantAccounts = () => call<{ merchantAccounts: MerchantAccount[]; bankAccounts: BankAccount[] }>("/merchant-accounts");
export const saveMerchant = (input: Partial<MerchantAccount> & { id?: string }) => send<{ merchantAccount: MerchantAccount }>("/merchant-accounts", input).then((result) => result.merchantAccount);
export const reportCsv = async (type: string, filters: Record<string, string | undefined> = {}) =>
  (await call<{ report: { csv: string } }>(`/reports?${qs({ ...filters, type, format: "csv" })}`)).report.csv;

export const CODE_LABEL: Record<string, string> = {
  PAYMENT_MISSING_INTERNAL: "Provider payment not in the ERP", PAYMENT_MISSING_PROVIDER: "No provider evidence yet", PAYMENT_AMOUNT_MISMATCH: "Amount differs", PAYMENT_CURRENCY_MISMATCH: "Currency differs",
  PAYMENT_DUPLICATE: "Possible duplicate", PAYMENT_UNAPPLIED: "Collected, no sale", PAYMENT_STATUS_UNKNOWN: "Outcome unknown", PAYMENT_WRONG_SOURCE: "Wrong transaction",
  REFUND_MISSING_PROVIDER: "Refund not confirmed", REFUND_AMOUNT_MISMATCH: "Refund amount differs", REFUND_DUPLICATE: "Possible duplicate refund", SETTLEMENT_MISSING: "Not settled in time",
  SETTLEMENT_AMOUNT_MISMATCH: "Payout differs from its lines", SETTLEMENT_FEE_MISMATCH: "Fees differ", BANK_RECEIPT_MISSING: "Not in the bank yet", BANK_RECEIPT_AMOUNT_MISMATCH: "Bank amount differs",
  MERCHANT_ACCOUNT_MISMATCH: "Wrong merchant account", CASH_SESSION_VARIANCE: "Cash difference", FINANCE_POSTING_MISSING: "Accounting not posted", PROVIDER_FILE_DUPLICATE: "File imported twice",
  CHECKOUT_PAYMENT_MISMATCH: "Sale paid ≠ total", PROVIDER_ADJUSTMENT_REPORTED: "Provider adjustment / chargeback",
};

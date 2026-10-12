"use client";

// Automatic Accounting Posting: the client of /api/accounting/{postings, journal-entries, ledger, posting-accounts, input-tax-credit, expenses,
// fund-transfers, opening-balances}. Errors arrive as AccountingApiError with the domain's plain-language message.
import { AccountingApiError } from "@/features/accounting/shared/client";

export { AccountingApiError };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// ------------------------------------------------------------------ postings
export type PostingStatus = "PENDING" | "DRAFT" | "POSTED" | "FAILED" | "REVERSED" | "CANCELLED";
export type Posting = {
  id: string; postingEvent: string; module: string; label: string; effect: string; automatic: boolean; sourceType: string; sourceId: string; sourceNumber: string | null;
  sourceHref: string | null; status: PostingStatus; journalEntryId: string | null; journalNumber: string | null; reversalJournalEntryId: string | null; reversalNumber: string | null;
  transactionDate: string | null; postingDate: string | null; amount: string | null; currency: string | null; attempts: number; detectedBy: string;
  error: { code: string; message: string; hint: string; at: string } | null; createdBy: string | null; createdAt: string; postedBy: string | null; postedAt: string | null;
  reversedAt: string | null; reversalReason: string | null; cancelledAt: string | null; cancelReason: string | null; retryable: boolean;
  history?: Array<{ outcome: string; code: string | null; message: string | null; at: string; journalEntryId: string | null; journalNumber: string | null; actor: string | null }>;
};
export type PostingHealth = {
  trialBalance: { debit: string; credit: string; balanced: boolean; difference: string }; unbalancedEntries: Array<{ id: string; number: string }>;
  postings: Record<PostingStatus, number>; stuckDrafts: number; unlinkedJournals: number; oldestFailureAt: string | null;
  modules: Array<{ module: string; posted: number; failed: number; other: number }>; healthy: boolean;
};
export type CoverageRow = { postingEvent: string; module: string; label: string; effect: string; oncePerDocument: boolean; retryable: boolean; posted: number; reversed: number; attention: number };

export const listPostings = (filters: Record<string, string | undefined>) => call<{ postings: Posting[] }>(`/postings${qs(filters)}`).then((r) => r.postings);
export const getPosting = (id: string) => call<{ posting: Posting }>(`/postings/${id}`).then((r) => r.posting);
export const retryPosting = (id: string) => post<{ posting: Posting }>(`/postings/${id}/retry`).then((r) => r.posting);
export const dismissPosting = (id: string, reason: string) => post<{ posting: Posting }>(`/postings/${id}/dismiss`, { reason }).then((r) => r.posting);
export const retryAllPostings = () => post<{ result: { posted: number; failed: number } }>(`/postings/retry-all`).then((r) => r.result);
export const scanPostings = () => post<{ result: { found: number } }>(`/postings/scan`).then((r) => r.result);
export const postingHealth = () => call<{ health: PostingHealth; coverage: CoverageRow[] }>(`/postings/health`);

export type SourceAccounting = { detailed: boolean; postings: Array<Posting & { lines: Array<{ account: string; debit: string; credit: string }>; reversalLines: Array<{ account: string; debit: string; credit: string }> }> };
export const sourceAccounting = (type: string, id: string) => call<{ accounting: SourceAccounting }>(`/postings/source${qs({ type, id })}`).then((r) => r.accounting);

// ------------------------------------------------------------------ journals and ledger
export type JournalRow = {
  id: string; number: string; accountingDate: string; transactionDate: string; type: string; description: string; reference: string | null; status: string; automatic: boolean;
  documentType: string; documentLabel: string; sourceNumber: string | null; sourceHref: string | null; total: string; currency: string; createdBy: string | null; postedBy: string | null; postedAt: string | null;
};
export type JournalDetail = {
  id: string; number: string; journal: string; period: string; periodStatus: string; entryDate: string; accountingDate: string; documentDate: string | null; type: string; description: string;
  reference: string | null; status: string; currency: string; functionalCurrency: string; exchangeRate: string; automatic: boolean;
  source: { type: string; label: string; module: string; number: string | null; href: string | null } | null;
  createdBy: string | null; createdAt: string; approvedBy: string | null; approvedAt: string | null; postedBy: string | null; postedAt: string | null;
  reversedBy: { id: string; number: string; reason: string | null } | null; reversalOf: { id: string; number: string } | null;
  lines: Array<{ sequence: number; accountId: string; account: string; accountClass: string; description: string | null; party: string | null; department: string | null; costCenter: string | null;
    taxType: string | null; currency: string; debit: string; credit: string }>;
  totals: { debit: string; credit: string }; posting: Posting | null;
};
export type AccountLedger = {
  account: { id: string; code: string; name: string; accountClass: string; normalBalance: string; status: string }; from: string | null; to: string | null;
  opening: string; debit: string; credit: string; closing: string;
  lines: Array<{ journalEntryId: string; journalNumber: string; date: string; description: string | null; party: string | null; document: string; sourceNumber: string | null; sourceHref: string | null;
    debit: string; credit: string; balance: string }>;
};
export const listJournals = (filters: Record<string, string | undefined>) => call<{ journals: JournalRow[] }>(`/journal-entries${qs(filters)}`).then((r) => r.journals);
export const getJournal = (id: string) => call<{ journal: JournalDetail }>(`/journal-entries/${id}`).then((r) => r.journal);
export const accountLedger = (accountId: string, filters: Record<string, string | undefined>) => call<{ ledger: AccountLedger }>(`/ledger/${accountId}${qs(filters)}`).then((r) => r.ledger);

// ------------------------------------------------------------------ posting accounts
export type PostingAccount = {
  key: string; group: string; label: string; purpose: string; optional: boolean; classes: string[]; state: "ok" | "missing" | "not_used" | "unusable" | "incompatible"; problem: string | null;
  account: { id: string; code: string; name: string; accountClass: string; since: string | null } | null; overrides: number;
  history: Array<{ account: string; from: string | null; to: string | null; status: string; changedBy: string | null }>;
};
export type AccountOption = { id: string; code: string; name: string; accountClass: string; accountType: string };
export const listPostingAccounts = () => call<{ postingAccounts: { ledgerId: string; items: PostingAccount[]; accounts: AccountOption[] } }>(`/posting-accounts`).then((r) => r.postingAccounts);
export const setPostingAccount = (key: string, accountId: string) => post<{ result: { changed: boolean; effectiveFrom?: string } }>(`/posting-accounts`, { key, accountId }).then((r) => r.result);

// ------------------------------------------------------------------ input tax credit
export type ItcStatus = "PENDING" | "ELIGIBLE" | "INELIGIBLE";
export type ItcRow = {
  sourceType: "vendor_bill" | "vendor_credit_note" | "expense"; sourceId: string; document: string; number: string | null; href: string | null; documentDate: string | null; supplier: string | null;
  gstin: string | null; taxPeriod: string; itcStatus: ItcStatus; tax: string; cgst: string; sgst: string; igst: string; cess: string; decidedAt: string | null; decidedBy: string | null; reason: string | null;
};
export const listItc = (status?: string) => call<{ itc: { rows: ItcRow[]; totals: { pending: string; eligible: string; ineligible: string } } }>(`/input-tax-credit${qs({ status })}`).then((r) => r.itc);
export const decideItc = (input: { sourceType: string; sourceId: string; decision: ItcStatus; reason: string; reference?: string }) => post(`/input-tax-credit`, { action: "decide", ...input });
export const undoItc = (input: { sourceType: string; sourceId: string; reason: string }) => post(`/input-tax-credit`, { action: "undo", ...input });

// ------------------------------------------------------------------ expenses, transfers, opening balances
export type Expense = {
  id: string; number: string; date: string; description: string; status: "DRAFT" | "SUBMITTED" | "POSTED" | "REJECTED" | "REVERSED" | "CANCELLED"; expenseAccount: { id: string; label: string };
  payee: string | null; supplierGstin: string | null; supplierInvoiceReference: string | null; currency: string; amount: string; gstTreatment: "NO_GST" | "GST_CLAIM_ITC" | "GST_NO_ITC";
  gstSupply: string | null; gstRate: string; taxAmount: string; total: string; settlement: "PAID" | "PAYABLE"; paidFrom: { id: string; label: string } | null; paidAt: string | null;
  submittedBy: string | null; submittedAt: string | null; approvedBy: string | null; approvedAt: string | null; rejectionReason: string | null; journalEntryId: string | null; journalNumber: string | null;
  paymentJournalEntryId: string | null; paymentJournalNumber: string | null; reversedAt: string | null; reversalReason: string | null; createdBy: string | null; createdAt: string; canApprove: boolean;
};
export const listExpenses = (filters: Record<string, string | undefined>) => call<{ expenses: Expense[] }>(`/expenses${qs(filters)}`).then((r) => r.expenses);
export const getExpense = (id: string) => call<{ expense: Expense }>(`/expenses/${id}`).then((r) => r.expense);
export const createExpense = (input: Record<string, unknown>) => post<{ expense: Expense }>(`/expenses`, input).then((r) => r.expense);
export const expenseAction = (id: string, action: "submit" | "approve" | "reject" | "cancel" | "pay" | "reverse", input: Record<string, unknown> = {}) =>
  post<{ expense: Expense }>(`/expenses/${id}/${action}`, input).then((r) => r.expense);

export type FundTransfer = {
  id: string; number: string; date: string; from: { id: string; label: string }; to: { id: string; label: string }; amount: string; currency: string; reference: string | null; description: string | null;
  status: "POSTED" | "REVERSED"; journalEntryId: string | null; journalNumber: string | null; reversedAt: string | null; reversalReason: string | null; createdBy: string | null; createdAt: string;
};
export const listTransfers = () => call<{ transfers: FundTransfer[] }>(`/fund-transfers`).then((r) => r.transfers);
export const createTransfer = (input: Record<string, unknown>) => post<{ transfer: FundTransfer }>(`/fund-transfers`, input).then((r) => r.transfer);
export const reverseTransfer = (id: string, reason: string) => post<{ transfer: FundTransfer }>(`/fund-transfers/${id}/reverse`, { reason }).then((r) => r.transfer);

export type OpeningBalances = {
  id: string; number: string; asOfDate: string; description: string; status: "DRAFT" | "SUBMITTED" | "POSTED" | "REJECTED" | "REVERSED"; totalDebit: string; totalCredit: string; balancingAmount: string;
  submittedBy: string | null; submittedAt: string | null; approvedBy: string | null; approvedAt: string | null; rejectionReason: string | null; journalEntryId: string | null; journalNumber: string | null;
  reversedAt: string | null; reversalReason: string | null; createdBy: string | null; createdAt: string; canApprove: boolean;
  lines: Array<{ accountId: string; account: string; description: string | null; debit: string; credit: string }>;
};
export const listOpenings = () => call<{ openingBalances: OpeningBalances[] }>(`/opening-balances`).then((r) => r.openingBalances);
export const saveOpening = (input: Record<string, unknown>) => post<{ openingBalances: OpeningBalances }>(`/opening-balances`, input).then((r) => r.openingBalances);
export const openingAction = (id: string, action: "submit" | "approve" | "reject" | "reverse", reason?: string) =>
  post<{ openingBalances: OpeningBalances }>(`/opening-balances/${id}/${action}`, reason ? { reason } : {}).then((r) => r.openingBalances);

// ------------------------------------------------------------------ shared labels
export const POSTING_STATUS: Record<PostingStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  PENDING: { label: "Waiting", tone: "info" }, DRAFT: { label: "Draft", tone: "info" }, POSTED: { label: "Posted", tone: "success" }, FAILED: { label: "Failed", tone: "danger" },
  REVERSED: { label: "Reversed", tone: "warning" }, CANCELLED: { label: "Dismissed", tone: "neutral" },
};
export const amount = (value: string | number | null | undefined, currency = "INR") => {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString("en-IN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const plain = (value: string | number | null | undefined) => {
  const numeric = Number(value ?? 0);
  return numeric === 0 ? "" : numeric.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

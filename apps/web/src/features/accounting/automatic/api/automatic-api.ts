"use client";

// Automatic Accounting Posting: the client of /api/accounting/{postings, journal-entries, ledger, posting-accounts, input-tax-credit, expenses,
// opening-balances}. Errors arrive as AccountingApiError with the domain's plain-language message.
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

// Each sub-ledger against the accounts that summarise it.
export type BooksCheck = {
  key: string; area: string; label: string; status: "ok" | "difference" | "attention" | "not_applicable" | "info"; ledger?: number; subledger?: number; difference?: number;
  ledgerLabel?: string; subledgerLabel?: string; note?: string | null; href?: string; count?: number; items?: Array<{ label: string; amount: number; href?: string }>;
};
export const moduleBooks = () => call<{ books: { checks: BooksCheck[]; agree: boolean; perpetualInventory: boolean } }>(`/postings/books`).then((r) => r.books);

export type SourceAccounting = { detailed: boolean; postings: Array<Posting & { lines: Array<{ account: string; debit: string; credit: string }>; reversalLines: Array<{ account: string; debit: string; credit: string }> }> };
export const sourceAccounting = (type: string, id: string) => call<{ accounting: SourceAccounting }>(`/postings/source${qs({ type, id })}`).then((r) => r.accounting);

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

// ------------------------------------------------------------------ opening balances
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

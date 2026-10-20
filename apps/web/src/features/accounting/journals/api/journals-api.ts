"use client";

// Journals and General Ledger (Finance MVP F2): the client of /api/accounting/{journal-entries, ledger, general-ledger}. Errors arrive as
// AccountingApiError with the domain's plain-language message and, for a form, the field it is about.
import type { Posting } from "@/features/accounting/automatic/api/automatic-api";
import { AccountingApiError } from "@/features/accounting/shared/client";

export class JournalApiError extends AccountingApiError {
  constructor(message: string, status: number, code?: string, public readonly field?: string) {
    super(message, status, code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false)
    throw new JournalApiError(payload.message || "The request could not be completed.", response.status, payload.code, typeof payload.field === "string" ? payload.field : undefined);
  return payload as T;
}
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
const send = <T>(method: string, path: string, body: unknown = {}) => call<T>(path, { method, body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);

// ------------------------------------------------------------------ journal list and record
export type JournalRow = {
  id: string; number: string; accountingDate: string; transactionDate: string; type: string; description: string; reference: string | null; status: string; automatic: boolean;
  documentType: string; documentLabel: string; sourceNumber: string | null; sourceHref: string | null; total: string; currency: string; createdBy: string | null; postedBy: string | null; postedAt: string | null;
};
export type JournalFormLine = {
  accountId: string; description: string; debit: string; credit: string; departmentId: string | null; costCenterId: string | null; partyId: string | null;
  dimensions: Array<{ dimensionId: string; dimensionValueId: string }>;
};
export type JournalDetail = {
  id: string; number: string; journal: string; journalId: string; period: string; periodStatus: string; entryDate: string; accountingDate: string; documentDate: string | null; type: string;
  entryType: string; description: string; reference: string | null; status: string; contentHash: string; currency: string; functionalCurrency: string; exchangeRate: string; automatic: boolean;
  manual: boolean; editable: boolean; updatedAt: string; submittedById: string | null;
  source: { type: string; label: string; module: string; number: string | null; href: string | null } | null;
  createdBy: string | null; createdAt: string; approvedBy: string | null; approvedAt: string | null; postedBy: string | null; postedAt: string | null;
  reversedBy: { id: string; number: string; reason: string | null } | null; reversalOf: { id: string; number: string } | null;
  correctionOf: { id: string; number: string } | null; correctedBy: { id: string; number: string; status: string } | null;
  lines: Array<{ sequence: number; accountId: string; account: string; accountClass: string; description: string | null; party: string | null; department: string | null; costCenter: string | null;
    taxType: string | null; currency: string; debit: string; credit: string }>;
  formLines: JournalFormLine[];
  totals: { debit: string; credit: string }; posting: Posting | null;
  history: Array<{ label: string; at: string; actor: string | null; detail: string | null }>;
};
export const listJournals = (filters: Record<string, string | undefined>) => call<{ journals: JournalRow[] }>(`/journal-entries${qs(filters)}`).then((r) => r.journals);
export const getJournal = (id: string) => call<{ journal: JournalDetail }>(`/journal-entries/${id}`).then((r) => r.journal);

// ------------------------------------------------------------------ writing a manual journal
export type JournalInput = {
  journalId?: string; accountingDate: string; documentDate?: string | null; reference?: string | null; description: string; currencyCode?: string; exchangeRate?: string;
  entryType?: string; expectedUpdatedAt?: string;
  lines: Array<{ accountId: string; description?: string | null; debit?: string; credit?: string; departmentId?: string | null; costCenterId?: string | null; partyId?: string | null;
    dimensions?: Array<{ dimensionId: string; dimensionValueId: string }> }>;
};
export type JournalOptions = {
  baseCurrency: string; today: string; approval: { required: boolean; threshold: string };
  journals: Array<{ id: string; code: string; name: string; type: string; approvalRequired: boolean }>;
  accounts: Array<{ id: string; code: string; name: string; accountClass: string; accountType: string; currencyCode: string | null }>;
  departments: Array<{ id: string; code: string | null; name: string }>;
  costCenters: Array<{ id: string; code: string | null; name: string; departmentId: string | null }>;
  parties: Array<{ id: string; name: string }>;
  currencies: Array<{ code: string; name: string }>;
  dimensions: Array<{ id: string; code: string; name: string; requiredFor: string[]; values: Array<{ id: string; code: string; name: string }> }>;
};
export const journalOptions = () => call<{ options: JournalOptions }>("/journal-entries/options").then((r) => r.options);
export const createJournal = (input: JournalInput) => send<{ journal: JournalDetail }>("POST", "/journal-entries", input).then((r) => r.journal);
export const updateJournal = (id: string, input: JournalInput) => send<{ journal: JournalDetail }>("PATCH", `/journal-entries/${id}`, input).then((r) => r.journal);
export type JournalStep = "submit" | "approve" | "reject" | "post" | "reverse" | "correct" | "discard";
export const journalStep = (id: string, step: JournalStep, input: { reason?: string; accountingDate?: string; contentHash?: string } = {}) =>
  send<{ journal: JournalDetail }>("POST", `/journal-entries/${id}/${step}`, input).then((r) => r.journal);

// ------------------------------------------------------------------ ledgers
export type AccountLedger = {
  account: { id: string; code: string; name: string; accountClass: string; normalBalance: string; status: string }; from: string | null; to: string | null;
  opening: string; debit: string; credit: string; closing: string;
  lines: Array<{ journalEntryId: string; journalNumber: string; date: string; description: string | null; party: string | null; document: string; sourceNumber: string | null; sourceHref: string | null;
    debit: string; credit: string; balance: string }>;
};
export const accountLedger = (accountId: string, filters: Record<string, string | undefined>) => call<{ ledger: AccountLedger }>(`/ledger/${accountId}${qs(filters)}`).then((r) => r.ledger);

export type Sided = { amount: string; side: "Dr" | "Cr" | null };
export type GeneralLedger = {
  from: string; to: string; balanced: boolean | null; totals: { debit: string; credit: string };
  accounts: Array<{ id: string; code: string; name: string; accountClass: string; accountType: string; normalBalance: string; status: string; opening: Sided; debit: string; credit: string;
    closing: Sided; lines: number }>;
};
export const generalLedger = (filters: Record<string, string | undefined>) => call<{ generalLedger: GeneralLedger }>(`/general-ledger${qs(filters)}`).then((r) => r.generalLedger);

// ------------------------------------------------------------------ labels
export const JOURNAL_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "info" }, pending_approval: { label: "Awaiting approval", tone: "info" }, approved: { label: "Approved", tone: "info" },
  rejected: { label: "Sent back", tone: "danger" }, posted: { label: "Posted", tone: "success" }, reversed: { label: "Reversed", tone: "warning" }, cancelled: { label: "Discarded", tone: "neutral" },
};
export const statusOf = (status: string) => JOURNAL_STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as const };
export { amount, plain } from "@/features/accounting/automatic/api/automatic-api";

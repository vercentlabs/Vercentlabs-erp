"use client";

// Banking (Finance MVP F6): the client of /api/accounting/{bank-accounts, bank-statements, bank-statement-lines, fund-transfers}.
import { AccountingApiError } from "@/features/accounting/shared/client";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);

// ------------------------------------------------------------------ bank and cash accounts
export type BankCashAccount = {
  id: string; code: string; kind: "bank" | "cash"; name: string; bankName: string | null; accountNumber: string | null; ifsc: string | null; type: string; currency: string;
  status: "active" | "inactive"; notes: string | null; custodian: { id: string; name: string } | null; ledgerAccount: { id: string; label: string }; balance: number;
  reconciledTo: string | null; linesToReconcile: number; updatedAt: string;
};
export type BankAccountOptions = { baseCurrency: string; ledgerAccounts: Array<{ id: string; label: string; kind: "bank" | "cash" }>; people: Array<{ id: string; name: string }> };
export type BankAccountInput = {
  kind: "bank" | "cash"; name: string; bankName?: string | null; accountNumber?: string | null; ifsc?: string | null; type?: string; ledgerAccountId?: string | null;
  custodianUserId?: string | null; notes?: string | null;
};
export const listBankAccounts = (includeInactive = false) =>
  call<{ accounts: BankCashAccount[] }>(`/bank-accounts${includeInactive ? "?includeInactive=true" : ""}`).then((r) => r.accounts);
export const bankAccountOptions = () => call<{ options: BankAccountOptions }>("/bank-accounts/options").then((r) => r.options);
export const getBankAccount = (id: string) => call<{ account: BankCashAccount; statements: StatementSummary[] }>(`/bank-accounts/${id}`);
export const createBankAccount = (input: BankAccountInput) => post<{ account: BankCashAccount }>("/bank-accounts", input).then((r) => r.account);
export const updateBankAccount = (id: string, input: Partial<BankAccountInput> & { status?: "active" | "inactive" }) =>
  call<{ account: BankCashAccount }>(`/bank-accounts/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((r) => r.account);
export const BANK_TYPES: Array<[string, string]> = [["current", "Current account"], ["savings", "Savings account"], ["credit_card", "Credit card"], ["loan", "Loan / overdraft"],
  ["virtual", "Virtual account"], ["other", "Other"]];

// ------------------------------------------------------------------ statements
export type StatementSummary = {
  id: string; number: string; from: string | null; to: string | null; opening: number; closing: number; status: "imported" | "reconciling" | "reconciled"; fileName: string | null;
  bankAccount: { id: string; name: string }; lines: number; settled: number; exceptions: number; suggested: number;
};
export type StatementField = "date" | "valueDate" | "description" | "reference" | "debit" | "credit" | "amount" | "direction" | "balance";
export type PreviewRow = {
  row: number; date: string | null; valueDate: string | null; description: string | null; reference: string | null; direction: "in" | "out" | null; amount: string | null;
  balance: string | null; errors: string[]; duplicate: { kind: "imported"; statement: string; lineId: string } | null; repeatOf: number | null;
};
export type StatementPreview = {
  bankAccount: { id: string; name: string; currency: string }; headers: string[]; headerRow: number; mapping: Record<StatementField, string | null>;
  fields: Array<{ key: StatementField; label: string }>; missing: string[]; rows: PreviewRow[];
  summary: { rows: number; ready: number; invalid: number; duplicates: number; repeated: number; moneyIn: string; moneyOut: string; from: string | null; to: string | null; lastBalance: string | null };
};
export type StatementUpload = { bankAccountId: string; file: File; mapping?: Record<string, string | null>; openingBalance?: string; closingBalance?: string };
const uploadForm = (input: StatementUpload) => {
  const form = new FormData();
  form.set("file", input.file);
  form.set("bankAccountId", input.bankAccountId);
  if (input.mapping) form.set("mapping", JSON.stringify(input.mapping));
  if (input.openingBalance) form.set("openingBalance", input.openingBalance);
  if (input.closingBalance) form.set("closingBalance", input.closingBalance);
  return form;
};
export const listStatements = (bankAccountId?: string) =>
  call<{ statements: StatementSummary[] }>(`/bank-statements${bankAccountId ? `?bankAccountId=${bankAccountId}` : ""}`).then((r) => r.statements);
export const previewStatement = (input: StatementUpload) => call<{ preview: StatementPreview }>("/bank-statements/preview", { method: "POST", body: uploadForm(input) }).then((r) => r.preview);
export const importStatement = (input: StatementUpload) =>
  call<{ statement: { id: string; number: string; lines: number; skippedDuplicates: number } }>("/bank-statements/import", { method: "POST", body: uploadForm(input) }).then((r) => r.statement);

// ------------------------------------------------------------------ reconciliation
export type LineState = "UNMATCHED" | "SUGGESTED_MATCH" | "PARTLY_MATCHED" | "MATCHED" | "RECONCILED" | "EXCEPTION" | "IGNORED";
export type WorkspaceLine = {
  id: string; sequence: number; date: string; description: string | null; reference: string | null; direction: "in" | "out"; amount: number; balance: number | null; state: LineState;
  suggestion: { journalLineId: string; entryNumber: string; date: string; description: string | null; score: number; reasons: string[] } | null;
  exception: { reason: string; at: string; by: string | null } | null;
  matches: Array<{ journalLineId: string; entryId: string; entryNumber: string; date: string; amount: number; description: string | null; type: string }>;
};
export type ReconciliationWorkspace = {
  statement: {
    id: string; number: string; status: StatementSummary["status"]; from: string; to: string; opening: number; closing: number; fileName: string | null; currency: string;
    bankAccount: { id: string; name: string; ledgerAccount: string; ledgerAccountId: string; cash: boolean };
  };
  lines: WorkspaceLine[];
  counts: { total: number; unmatched: number; suggested: number; matched: number; exceptions: number; ignored: number; partly: number };
  moneyIn: number; moneyOut: number; bookBalance: number;
  notOnStatement: Array<{ journalLineId: string; entryNumber: string; date: string; description: string | null; amount: number }>;
  previous: { number: string; closing: number; to: string } | null; continues: boolean; canComplete: boolean; blockers: string[];
};
export type Candidate = {
  journalLineId: string; entryId: string; entryNumber: string; date: string; amount: number; description: string | null; reference: string | null; party: string | null;
  score: number; reasons: string[];
};
export const getWorkspace = (statementId: string) => call<{ workspace: ReconciliationWorkspace }>(`/bank-statements/${statementId}`).then((r) => r.workspace);
export const statementStep = (statementId: string, step: "complete" | "reopen", input: { reason?: string } = {}) =>
  post<{ workspace: ReconciliationWorkspace }>(`/bank-statements/${statementId}/${step}`, input).then((r) => r.workspace);
export const lineCandidates = (lineId: string) => call<{ candidates: Candidate[] }>(`/bank-statement-lines/${lineId}/candidates`).then((r) => r.candidates);
export type LineStep = "accept" | "match" | "unmatch" | "exception" | "clear-exception" | "ignore" | "post-entry";
export const lineStep = (lineId: string, step: LineStep, input: { journalLineIds?: string[]; reason?: string; accountId?: string; description?: string } = {}) =>
  post<{ lineId: string; journalEntryId?: string }>(`/bank-statement-lines/${lineId}/${step}`, input);

export const LINE_STATE: Record<LineState, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  UNMATCHED: { label: "Unmatched", tone: "warning" }, SUGGESTED_MATCH: { label: "Suggested", tone: "info" }, PARTLY_MATCHED: { label: "Partly matched", tone: "info" },
  MATCHED: { label: "Matched", tone: "success" }, RECONCILED: { label: "Reconciled", tone: "success" }, EXCEPTION: { label: "Exception", tone: "danger" }, IGNORED: { label: "Ignored", tone: "neutral" },
};
export const STATEMENT_STATUS: Record<StatementSummary["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  imported: { label: "To reconcile", tone: "warning" }, reconciling: { label: "Reconciling", tone: "info" }, reconciled: { label: "Reconciled", tone: "success" },
};

// ------------------------------------------------------------------ transfers
export type TransferState = "IN_TRANSIT" | "COMPLETED" | "REVERSED";
export type FundTransfer = {
  id: string; number: string; date: string; arrivalDate: string | null; state: TransferState; from: { id: string; label: string }; to: { id: string; label: string }; amount: string;
  currency: string; reference: string | null; description: string | null; status: "POSTED" | "REVERSED"; journalEntryId: string | null; journalNumber: string | null;
  arrivalJournalEntryId: string | null; receivedAt: string | null; reversedAt: string | null; reversalReason: string | null; createdBy: string | null; createdAt: string;
};
export const listTransfers = () => call<{ transfers: FundTransfer[] }>("/fund-transfers").then((r) => r.transfers);
export const createTransfer = (input: Record<string, unknown>) => post<{ transfer: FundTransfer }>("/fund-transfers", input).then((r) => r.transfer);
export const receiveTransfer = (id: string, arrivalDate: string) => post<{ transfer: FundTransfer }>(`/fund-transfers/${id}/receive`, { arrivalDate }).then((r) => r.transfer);
export const reverseTransfer = (id: string, reason: string) => post<{ transfer: FundTransfer }>(`/fund-transfers/${id}/reverse`, { reason }).then((r) => r.transfer);
export const TRANSFER_STATE: Record<TransferState, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  IN_TRANSIT: { label: "In transit", tone: "warning" }, COMPLETED: { label: "Completed", tone: "success" }, REVERSED: { label: "Reversed", tone: "neutral" },
};

export { inr, cents, fromCents } from "@/features/accounting/receivables/api/receivables-api";

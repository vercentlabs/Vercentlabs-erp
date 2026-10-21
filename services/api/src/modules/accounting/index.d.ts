import type { QueryClient } from "../../index.js";
export type AccountingContext = { organizationId: string; userId: string; permissions: string[]; roleSlugs: string[] };
export class AccountingError extends Error { readonly status: number; readonly code: string; readonly details?: Record<string, unknown>; constructor(status: number, message: string, code?: string, details?: Record<string, unknown>); }
export type AccountingRecord = Record<string, unknown>;
export function getFinanceHome(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function getAccountingOptions(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function getAccountingSettings(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function updateAccountingSettings(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function upsertAccountMapping(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function listJournalEntries(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getJournalEntry(client: QueryClient, context: AccountingContext, id: string): Promise<{ entry: AccountingRecord; lines: AccountingRecord[]; events: AccountingRecord[] }>;
export function createJournalEntry(client: QueryClient, context: AccountingContext, input: AccountingRecord, options?: AccountingRecord): Promise<{ entry: AccountingRecord; lines: AccountingRecord[] }>;
export function submitJournalEntry(client: QueryClient, context: AccountingContext, id: string, assignedTo?: string | null): Promise<AccountingRecord>;
export function approveJournalEntry(client: QueryClient, context: AccountingContext, id: string, contentHash: string): Promise<AccountingRecord>;
export function rejectJournalApproval(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function postJournalEntry(client: QueryClient, context: AccountingContext, id: string, options?: AccountingRecord): Promise<AccountingRecord>;
export function reverseJournalEntry(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;
export function listCustomerInvoices(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getCustomerInvoice(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function createCustomerInvoice(client: QueryClient, context: AccountingContext, input: AccountingRecord, options?: AccountingRecord): Promise<AccountingRecord>;
export function replaceCustomerInvoiceDraft(client: QueryClient, context: AccountingContext, invoiceId: string, input: AccountingRecord, options?: { internal?: boolean }): Promise<{ lineIds: string[]; dueDate: string }>;
export function cancelCustomerInvoiceDraft(client: QueryClient, context: AccountingContext, invoiceId: string, input?: { reason?: string | null }, options?: { internal?: boolean }): Promise<{ id: string; status: string; changed: boolean }>;
export function reverseCustomerInvoice(client: QueryClient, context: AccountingContext, invoiceId: string, input: { reason: string; accountingDate?: string }, options?: { internal?: boolean }): Promise<{ id: string; status: string; changed: boolean; reversalEntryId?: string }>;
export function submitCustomerInvoice(client: QueryClient, context: AccountingContext, id: string, assignedTo?: string | null): Promise<AccountingRecord>;
export function approveCustomerInvoice(client: QueryClient, context: AccountingContext, id: string, contentHash: string): Promise<AccountingRecord>;
export function rejectCustomerInvoiceApproval(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function postCustomerInvoice(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function applyCustomerCreditNote(client: QueryClient, context: AccountingContext, id: string, input: AccountingRecord): Promise<AccountingRecord>;
export function createCustomerReceipt(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function postCustomerReceipt(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function allocateCustomerReceipt(client: QueryClient, context: AccountingContext, id: string, input: AccountingRecord): Promise<AccountingRecord>;
export function listVendorBills(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getVendorBill(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function createVendorBill(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function submitVendorBill(client: QueryClient, context: AccountingContext, id: string, assignedTo?: string | null): Promise<AccountingRecord>;
export function approveVendorBill(client: QueryClient, context: AccountingContext, id: string, contentHash: string): Promise<AccountingRecord>;
export function rejectVendorBillApproval(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function postVendorBill(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function applyVendorCreditNote(client: QueryClient, context: AccountingContext, id: string, input: AccountingRecord): Promise<AccountingRecord>;
export function createVendorPayment(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function submitVendorPayment(client: QueryClient, context: AccountingContext, id: string, assignedTo?: string | null): Promise<AccountingRecord>;
export function approveVendorPayment(client: QueryClient, context: AccountingContext, id: string, contentHash: string): Promise<AccountingRecord>;
export function rejectVendorPaymentApproval(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function postVendorPayment(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function allocateVendorPayment(client: QueryClient, context: AccountingContext, id: string, input: AccountingRecord): Promise<AccountingRecord>;
export function initializeAccountingOrganization(
  client: QueryClient,
  input: { organizationId: string; userId: string },
): Promise<{ ledgerId: string; accountCount: number }>;
export function getVendorBillMatch(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord | null>;
export function evaluateVendorBillMatch(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;
export function overrideVendorBillMatch(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;
export function allocateInstallments(total: string | number, termLines: AccountingRecord[], precision?: number): AccountingRecord[];

export function calculateSettlementBaseAmounts(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function createCustomerSettlementAdjustment(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function createVendorSettlementAdjustment(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function reverseCustomerCreditNote(client: QueryClient, context: AccountingContext, id: string, input: { reason: string; accountingDate?: string }, options?: { internal?: boolean }): Promise<AccountingRecord>;
export function changeCustomerInvoiceDueDate(client: QueryClient, context: AccountingContext, id: string, input: { dueDate: string; reason: string }, options?: { internal?: boolean }): Promise<AccountingRecord>;
export * from "./refunds/index.js";
export function resolvePaymentSchedule(client: QueryClient, context: AccountingContext, options: AccountingRecord): Promise<AccountingRecord>;
export declare function recordVendorCreditRefund(client: any, context: any, ...args: any[]): Promise<any>;
export declare function reverseVendorCreditRefund(client: any, context: any, ...args: any[]): Promise<any>;
export declare function unapplyVendorCreditNote(client: any, context: any, ...args: any[]): Promise<any>;
export declare function reverseVendorCreditNote(client: any, context: any, ...args: any[]): Promise<any>;
export declare function reduceBillSchedules(client: any, context: any, ...args: any[]): Promise<any>;
export declare function restoreBillSchedules(client: any, context: any, ...args: any[]): Promise<any>;

// Item accounting profiles (inventory and accounting accounts for items).
export declare const ITEM_PROFILE_KINDS: ReadonlyArray<{ code: string; label: string }>;
export declare const ITEM_PROFILE_ACCOUNTS: Readonly<Record<string, { kind: string; column: string; field: string; label: string }>>;
export declare function listItemProfiles(client: any, context: any, options?: { kind?: string | null; includeInactive?: boolean }): Promise<any[]>;
export declare function getItemProfile(client: any, context: any, profileId: string): Promise<any>;
export declare function createItemProfile(client: any, context: any, input: Record<string, unknown>): Promise<any>;
export declare function updateItemProfile(client: any, context: any, profileId: string, input: Record<string, unknown>): Promise<any>;
export declare function setItemProfileStatus(client: any, context: any, profileId: string, status: string): Promise<any>;
export declare function itemProfileAccount(client: any, organizationId: string, itemId: string, mappingKey: string): Promise<any>;

// Automatic Accounting Posting: the shared posting service, input tax credit, and the finance documents that post through it.
export type PostingHandler = (client: QueryClient, context: AccountingContext, sourceId: string) => Promise<unknown>;
export const POSTING_EVENTS: Readonly<Record<string, { module: string; label: string; effect: string; once: boolean; href: string | null }>>;
export const POSTING_ACCOUNTS: Readonly<Record<string, { group: string; label: string; classes: string[]; purpose: string; optional: boolean }>>;
export function postingAccountLabel(mappingKey: string): string;
export function explainPostingError(error: unknown): { code: string; message: string; hint: string };
export function registerPostingRetry(postingEvent: string, handler: PostingHandler): void;
export function recordPostingFailure(client: QueryClient, context: AccountingContext, descriptor: AccountingRecord, error: unknown): Promise<AccountingRecord>;
export function runOutboxPosting<T>(client: QueryClient, context: AccountingContext, descriptor: AccountingRecord, work: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; failure: AccountingRecord }>;
export function listPostings(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getPosting(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function retryPosting(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function retryFailedPostings(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<{ posted: number; failed: number }>;
export function dismissPosting(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;
export function scanMissingPostings(client: QueryClient, context: AccountingContext): Promise<{ found: number; items: AccountingRecord[] }>;
export function getSourceAccounting(client: QueryClient, context: AccountingContext, sourceType: string, sourceId: string): Promise<AccountingRecord>;
export function searchJournalEntries(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getJournalEntryDetail(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function getAccountLedger(client: QueryClient, context: AccountingContext, accountId: string, filters?: AccountingRecord): Promise<AccountingRecord>;
export function getPostingHealth(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function getPostingCoverage(client: QueryClient, context: AccountingContext): Promise<AccountingRecord[]>;
export function listPostingAccounts(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function setPostingAccount(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function listInputTaxCredit(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord>;
export function decideInputTaxCredit(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function undoInputTaxCreditDecision(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function listFundTransfers(client: QueryClient, context: AccountingContext): Promise<AccountingRecord[]>;
export function createFundTransfer(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function reverseFundTransfer(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;
export function listOpeningBalances(client: QueryClient, context: AccountingContext): Promise<AccountingRecord[]>;
export function getOpeningBalances(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function saveOpeningBalances(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<AccountingRecord>;
export function submitOpeningBalances(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function approveOpeningBalances(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function rejectOpeningBalances(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;
export function reverseOpeningBalances(client: QueryClient, context: AccountingContext, id: string, input?: AccountingRecord): Promise<AccountingRecord>;

// Finance MVP F1 — Chart of Accounts and fiscal years.
export type ChartAccount = {
  id: string; ledgerId: string; parentId: string | null; code: string; name: string; accountClass: string; accountType: string; accountTypeLabel: string;
  normalBalance: "debit" | "credit"; isGroup: boolean; allowManualPosting: boolean; reconciliationRequired: boolean; controlKind: string | null;
  controlLabel: string | null; manualPostingLocked: boolean; currencyCode: string | null; cashFlowCategory: string | null; status: string; updatedAt: string;
  debit: number; credit: number; balance: number; postingCount: number; mappings: string[]; depth?: number; childCount?: number;
};
export const ACCOUNT_CLASSES: ReadonlyArray<{ code: string; label: string; normalBalance: "debit" | "credit" }>;
export const ACCOUNT_TYPES_BY_CLASS: Readonly<Record<string, readonly string[]>>;
export const ACCOUNT_TYPE_LABELS: Readonly<Record<string, string>>;
export const CONTROL_KINDS: Readonly<Record<string, string>>;
export const NO_MANUAL_CONTROL_KINDS: readonly string[];
export function listChartOfAccounts(client: QueryClient, context: AccountingContext, options?: { includeInactive?: boolean }): Promise<{ accounts: ChartAccount[]; classes: typeof ACCOUNT_CLASSES }>;
export function getChartAccount(client: QueryClient, context: AccountingContext, id: string): Promise<ChartAccount>;
export function createChartAccount(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<ChartAccount>;
export function updateChartAccount(client: QueryClient, context: AccountingContext, id: string, input: AccountingRecord): Promise<ChartAccount>;
export function setChartAccountStatus(client: QueryClient, context: AccountingContext, id: string, status: "active" | "inactive"): Promise<ChartAccount>;
export function deleteChartAccount(client: QueryClient, context: AccountingContext, id: string): Promise<{ deleted: true }>;
export function getControlAccountReconciliation(client: QueryClient, context: AccountingContext): Promise<Array<{ kind: string; label: string; ledger: number; subledger: number; subledgerLabel: string; difference: number; agrees: boolean }>>;
export type FiscalPeriod = { id: string; name: string; number: number | null; type: string; startDate: string; endDate: string; status: string; statusKey: string; statusLabel: string; journalCount: number; note: string | null };
export type FiscalYear = { id: string; code: string; name: string; startDate: string; endDate: string; status: string; current: boolean; periods: FiscalPeriod[]; counts: Record<string, number> };
export const PERIOD_STATUS: Readonly<Record<string, { key: string; label: string }>>;
export function listFiscalYears(client: QueryClient, context: AccountingContext): Promise<FiscalYear[]>;
export function createFiscalYear(client: QueryClient, context: AccountingContext, input?: { startDate?: string; withAdjustmentPeriod?: boolean }): Promise<FiscalYear | undefined>;
export function setPeriodReview(client: QueryClient, context: AccountingContext, periodId: string, input: { review: boolean; note?: string }): Promise<FiscalPeriod>;

// Finance MVP F2 — manual journals and the General Ledger.
export type ManualJournalLineInput = {
  accountId: string; description?: string | null; debit?: string; credit?: string; departmentId?: string | null; costCenterId?: string | null; partyId?: string | null;
  dimensions?: Array<{ dimensionId: string; dimensionValueId: string }>;
};
export type ManualJournalInput = {
  journalId?: string; accountingDate?: string; documentDate?: string | null; reference?: string | null; description?: string; currencyCode?: string; exchangeRate?: string;
  entryType?: string; lines?: ManualJournalLineInput[]; expectedUpdatedAt?: string;
};
export function createManualJournal(client: QueryClient, context: AccountingContext, input: ManualJournalInput): Promise<AccountingRecord>;
export function updateManualJournal(client: QueryClient, context: AccountingContext, id: string, input: ManualJournalInput): Promise<AccountingRecord>;
export function discardManualJournal(client: QueryClient, context: AccountingContext, id: string, input: { reason: string }): Promise<AccountingRecord>;
export function reverseManualJournal(client: QueryClient, context: AccountingContext, id: string, input: { reason: string; accountingDate?: string }): Promise<AccountingRecord>;
export function correctManualJournal(client: QueryClient, context: AccountingContext, id: string, input: { reason: string; accountingDate?: string }): Promise<AccountingRecord>;
export function getJournalRecord(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function getJournalFormOptions(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function getGeneralLedgerSummary(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord>;
export function localToday(): string;

// Finance MVP F3 — the posting engine: payroll postings and the module-to-GL checks.
export type PayrollPostingOptions = { internal?: boolean };
export function postPayrollRun(client: QueryClient, context: AccountingContext, input: {
  payrollRunId: string; number: string; postingDate: string; period?: string;
  lines: Array<{ departmentId?: string | null; costCenterId?: string | null; gross: string; employerEpf?: string; employerEsi?: string }>;
  deductions?: { tds?: string; employeeEpf?: string; employeeEsi?: string; pt?: string }; otherDeductions?: Array<{ accountId: string; amount: string; description?: string }>; netPay: string;
}, options?: PayrollPostingOptions): Promise<AccountingRecord>;
export function postSalaryPayment(client: QueryClient, context: AccountingContext, input: { paymentId: string; number: string; paymentDate: string; amount: string; paidFromAccountId: string; payrollRunNumber?: string }, options?: PayrollPostingOptions): Promise<AccountingRecord>;
export function postStatutoryPayment(client: QueryClient, context: AccountingContext, input: { paymentId: string; number: string; kind: "tds" | "epf" | "esi" | "pt"; paymentDate: string; amount: string; paidFromAccountId: string }, options?: PayrollPostingOptions): Promise<AccountingRecord>;
export function reversePayrollPosting(client: QueryClient, context: AccountingContext, input: { event: "payroll_run" | "salary_payment" | "statutory_payment"; sourceId: string; reason: string; accountingDate?: string }, options?: PayrollPostingOptions): Promise<AccountingRecord>;
export type ModuleCheck = {
  key: string; area: string; label: string; status: "ok" | "difference" | "attention" | "not_applicable" | "info"; ledger?: number; subledger?: number; difference?: number;
  ledgerLabel?: string; subledgerLabel?: string; note?: string | null; href?: string; count?: number; items?: Array<{ label: string; amount: number; href?: string }>;
};
export function getModuleReconciliation(client: QueryClient, context: AccountingContext): Promise<{ checks: ModuleCheck[]; agree: boolean; perpetualInventory: boolean }>;

// Finance MVP F4 — receivables, and the customer / supplier ledgers (aging, statements).
export type PartySide = "receivable" | "payable";
export type ReceiptAllocationInput = { invoiceId: string; amount: string; discountTaken?: string; writeoffAmount?: string };
export function recordCustomerReceipt(client: QueryClient, context: AccountingContext, input: {
  partyId: string; receiptDate: string; amount: string; currencyCode?: string; exchangeRate?: string; bankAccountId?: string | null; paymentMethod: string; reference?: string | null;
  notes?: string | null; allocations?: ReceiptAllocationInput[]; applyToOldest?: boolean;
}): Promise<{ id: string; number: string }>;
export function applyReceipt(client: QueryClient, context: AccountingContext, receiptId: string, input: { allocations: ReceiptAllocationInput[] }): Promise<{ id: string }>;
export function applyReceiptToOldest(client: QueryClient, context: AccountingContext, receiptId: string): Promise<{ id: string }>;
export function undoReceiptAllocation(client: QueryClient, context: AccountingContext, allocationId: string, input: { reason: string }): Promise<{ id: string }>;
export function reverseCustomerReceipt(client: QueryClient, context: AccountingContext, receiptId: string, input: { reason: string; accountingDate?: string }): Promise<{ id: string }>;
export function listReceivableInvoices(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function listCustomerReceipts(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getCustomerReceiptRecord(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function getReceiptFormOptions(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord>;
export function getPartyAging(client: QueryClient, context: AccountingContext, side: PartySide, filters?: AccountingRecord): Promise<AccountingRecord>;
export function getPartyOpenItems(client: QueryClient, context: AccountingContext, side: PartySide, partyId: string, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getPartyStatement(client: QueryClient, context: AccountingContext, side: PartySide, partyId: string, filters?: AccountingRecord): Promise<AccountingRecord>;

// Finance MVP F5 — payables.
export type PaymentPlanInput = { billId: string; amount: string };
export function prepareVendorPayment(client: QueryClient, context: AccountingContext, input: {
  partyId: string; paymentDate: string; amount: string; currencyCode?: string; exchangeRate?: string; bankAccountId?: string | null; paymentMethod: string; reference?: string | null;
  notes?: string | null; allocations?: PaymentPlanInput[]; applyToOldest?: boolean;
}): Promise<{ id: string; number: string; status: string }>;
export function reverseVendorPayment(client: QueryClient, context: AccountingContext, paymentId: string, input: { reason: string }): Promise<AccountingRecord>;
export function postApprovedPayment(client: QueryClient, context: AccountingContext, paymentId: string): Promise<{ id: string; skipped: string[] }>;
export function applyPayment(client: QueryClient, context: AccountingContext, paymentId: string, input: { allocations: PaymentPlanInput[] }): Promise<{ id: string }>;
export function applyPaymentToOldest(client: QueryClient, context: AccountingContext, paymentId: string): Promise<{ id: string }>;
export function undoPaymentAllocation(client: QueryClient, context: AccountingContext, allocationId: string, input: { reason: string }): Promise<{ id: string }>;
export function discardVendorPayment(client: QueryClient, context: AccountingContext, paymentId: string, input: { reason: string }): Promise<{ id: string }>;
export function resubmitVendorPayment(client: QueryClient, context: AccountingContext, paymentId: string): Promise<{ id: string }>;
export function listPayableBills(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function listVendorPayments(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getVendorPaymentRecord(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function getPaymentFormOptions(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord>;

// Finance MVP F6 — banking: bank and cash accounts, statement import, reconciliation, transfers through transit.
export type BankLineState = "UNMATCHED" | "SUGGESTED_MATCH" | "PARTLY_MATCHED" | "MATCHED" | "RECONCILED" | "EXCEPTION" | "IGNORED";
export function maskAccountNumber(value: unknown): string | null;
export function listBankCashAccounts(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getBankCashAccount(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function getBankAccountFormOptions(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function createBankCashAccount(client: QueryClient, context: AccountingContext, input: {
  kind: "bank" | "cash"; name: string; bankName?: string | null; accountNumber?: string | null; ifsc?: string | null; type?: string; currencyCode?: string;
  ledgerAccountId?: string | null; custodianUserId?: string | null; notes?: string | null; code?: string;
}): Promise<AccountingRecord>;
export function updateBankCashAccount(client: QueryClient, context: AccountingContext, id: string, input: {
  name?: string; bankName?: string; accountNumber?: string | null; ifsc?: string | null; custodianUserId?: string | null; notes?: string | null; status?: "active" | "inactive";
}): Promise<AccountingRecord>;
export type StatementFileInput = {
  bankAccountId: string; fileName: string; fileBase64?: string; csvText?: string; mapping?: Record<string, string | null>;
  openingBalance?: string | null; closingBalance?: string | null; statementNumber?: string;
};
export function parseStatementDate(value: unknown): string | null;
export function fingerprintOf(bankAccountId: string, date: string, direction: string, amount: bigint, reference: string | null): string;
export const STATEMENT_FIELDS: Record<string, string>;
export function previewBankStatement(client: QueryClient, context: AccountingContext, input: StatementFileInput): Promise<AccountingRecord>;
export function importBankStatementFile(client: QueryClient, context: AccountingContext, input: StatementFileInput): Promise<{ id: string; number: string; lines: number; skippedDuplicates: number }>;
export function lineState(line: AccountingRecord, statementStatus: string): BankLineState;
export function suggestForStatement(client: QueryClient, context: AccountingContext, statementId: string): Promise<unknown>;
export function matchStatementLine(client: QueryClient, context: AccountingContext, lineId: string, input: { journalLineIds: string[]; note?: string }): Promise<{ lineId: string }>;
export function acceptSuggestion(client: QueryClient, context: AccountingContext, lineId: string): Promise<{ lineId: string }>;
export function unmatchStatementLine(client: QueryClient, context: AccountingContext, lineId: string): Promise<{ lineId: string }>;
export function markLineException(client: QueryClient, context: AccountingContext, lineId: string, input: { reason: string }): Promise<{ lineId: string }>;
export function clearLineException(client: QueryClient, context: AccountingContext, lineId: string): Promise<{ lineId: string }>;
export function ignoreStatementLine(client: QueryClient, context: AccountingContext, lineId: string, input: { reason: string }): Promise<{ lineId: string }>;
export function postEntryForLine(client: QueryClient, context: AccountingContext, lineId: string, input: { accountId: string; description?: string }): Promise<{ lineId: string; journalEntryId: string }>;
export function getReconciliationWorkspace(client: QueryClient, context: AccountingContext, statementId: string): Promise<AccountingRecord>;
export function getLineCandidates(client: QueryClient, context: AccountingContext, lineId: string): Promise<AccountingRecord[]>;
export function completeStatementReconciliation(client: QueryClient, context: AccountingContext, statementId: string): Promise<AccountingRecord>;
export function reopenStatementReconciliation(client: QueryClient, context: AccountingContext, statementId: string, input: { reason: string }): Promise<AccountingRecord>;
export function listBankStatementsOverview(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function receiveFundTransfer(client: QueryClient, context: AccountingContext, id: string, input?: { arrivalDate?: string }): Promise<AccountingRecord>;

// Finance MVP F7 — expenses and expense categories.
export const EXPENSE_CATEGORY_SEED: ReadonlyArray<readonly [string, string, string, string, number | null, boolean, number, number]>;
export const EXPENSE_PAYMENT_METHODS: readonly string[];
export const EXPENSE_FILE_ENTITY: string;
export type ExpenseCategoryInput = {
  name: string; code?: string; description?: string | null; accountId: string; defaultGstRate?: number | string | null; receiptRequired?: boolean;
  receiptThreshold?: number | string; sortOrder?: number;
};
export function listAccountingExpenseCategories(client: QueryClient, context: AccountingContext, filters?: { includeInactive?: boolean | string }): Promise<AccountingRecord[]>;
export function getAccountingExpenseCategoryOptions(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function createAccountingExpenseCategory(client: QueryClient, context: AccountingContext, input: ExpenseCategoryInput): Promise<AccountingRecord>;
export function updateAccountingExpenseCategory(client: QueryClient, context: AccountingContext, id: string, input: Partial<ExpenseCategoryInput> & { status?: "active" | "inactive" }): Promise<AccountingRecord>;
export type ExpenseInput = {
  categoryId: string; date?: string; description: string; amount: number | string; partyId?: string | null; payeeName?: string | null; supplierGstin?: string | null;
  supplierInvoiceReference?: string | null; gstTreatment?: "NO_GST" | "GST_CLAIM_ITC" | "GST_NO_ITC"; gstSupply?: "INTRA_STATE" | "INTER_STATE" | null; gstRate?: number | string | null;
  settlement: "PAID" | "PAYABLE"; paidFromAccountId?: string | null; paymentMethod?: string | null; claimantUserId?: string | null; departmentId?: string | null;
  costCenterId?: string | null; notes?: string | null; noReceiptReason?: string | null; submit?: boolean; idempotencyKey?: string; version?: number;
};
export function listExpenses(client: QueryClient, context: AccountingContext, filters?: AccountingRecord): Promise<AccountingRecord[]>;
export function getExpenseCounts(client: QueryClient, context: AccountingContext): Promise<{ toApprove: number; toPay: number; owed: number; drafts: number; thisMonth: number }>;
export function getExpenseRecord(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function getExpenseFormOptions(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function expenseState(row: AccountingRecord): string;
export function createExpense(client: QueryClient, context: AccountingContext, input: ExpenseInput): Promise<AccountingRecord>;
export function updateExpense(client: QueryClient, context: AccountingContext, id: string, input: Partial<ExpenseInput>): Promise<AccountingRecord>;
export function submitExpense(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function approveExpense(client: QueryClient, context: AccountingContext, id: string): Promise<AccountingRecord>;
export function rejectExpense(client: QueryClient, context: AccountingContext, id: string, input: { reason?: string }): Promise<AccountingRecord>;
export function cancelExpense(client: QueryClient, context: AccountingContext, id: string, input: { reason?: string }): Promise<AccountingRecord>;
export function payExpense(client: QueryClient, context: AccountingContext, id: string, input: { paidFromAccountId?: string; date?: string; paymentMethod?: string }): Promise<AccountingRecord>;
export function reverseExpense(client: QueryClient, context: AccountingContext, id: string, input: { reason?: string }): Promise<AccountingRecord>;
export function listAccountingExpenseFiles(client: QueryClient, context: AccountingContext, expenseId: string): Promise<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>>;
export function prepareAccountingExpenseFileUpload(input: { fileName: string; bytes: Buffer }, env?: Record<string, string | undefined>): Promise<unknown>;
export function uploadAccountingExpenseFile(client: QueryClient, context: AccountingContext, expenseId: string, input: { prepared: unknown }): Promise<{ id: string; fileName: string }>;
export function removeAccountingExpenseFile(client: QueryClient, context: AccountingContext, expenseId: string, fileId: string): Promise<{ removed: boolean }>;
export function readAccountingExpenseFile(client: QueryClient, context: AccountingContext, expenseId: string, fileId: string): Promise<{ fileName: string; mimeType: string; body: Buffer }>;

// Finance MVP F8 — financial statements.
export function getStatementPeriods(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function getTrialBalanceStatement(client: QueryClient, context: AccountingContext, filters?: { from?: string; to?: string; showZero?: boolean | string }): Promise<AccountingRecord>;
export function getProfitAndLossStatement(client: QueryClient, context: AccountingContext, filters?: { from?: string; to?: string; compare?: string }): Promise<AccountingRecord>;
export function getBalanceSheetStatement(client: QueryClient, context: AccountingContext, filters?: { asOf?: string; compareTo?: string }): Promise<AccountingRecord>;
export function getCashFlowStatement(client: QueryClient, context: AccountingContext, filters?: { from?: string; to?: string }): Promise<AccountingRecord>;

// Finance MVP F9 — period close.
export const PERIOD_CLOSE_STATUS: Readonly<Record<string, { key: string; label: string }>>;
export function getCloseOverview(client: QueryClient, context: AccountingContext): Promise<AccountingRecord>;
export function getPeriodCloseWorkspace(client: QueryClient, context: AccountingContext, periodId: string): Promise<AccountingRecord>;
export function startPeriodReview(client: QueryClient, context: AccountingContext, periodId: string, input?: { note?: string }): Promise<AccountingRecord>;
export function returnPeriodToOpen(client: QueryClient, context: AccountingContext, periodId: string, input?: { note?: string }): Promise<AccountingRecord>;
export function closePeriod(client: QueryClient, context: AccountingContext, periodId: string, input?: { note?: string }): Promise<AccountingRecord>;
export function lockPeriod(client: QueryClient, context: AccountingContext, periodId: string): Promise<AccountingRecord>;
export function reopenPeriod(client: QueryClient, context: AccountingContext, periodId: string, input: { reason: string }): Promise<AccountingRecord>;
export function acknowledgeCloseCheck(client: QueryClient, context: AccountingContext, periodId: string, input: { checkKey: string; reason: string }): Promise<AccountingRecord>;
export function withdrawCloseAcknowledgement(client: QueryClient, context: AccountingContext, periodId: string, input: { checkKey: string }): Promise<AccountingRecord>;
export function closeFinancialYear(client: QueryClient, context: AccountingContext, yearId: string, input?: { note?: string }): Promise<AccountingRecord>;

// Accounting's own New invoice and New bill (direct-documents.js).
export declare const GST_RATES: readonly number[];
export function createAccountingInvoice(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<{ id: string; status: "draft" | "pending_approval" | "posted" }>;
export function createAccountingBill(client: QueryClient, context: AccountingContext, input: AccountingRecord): Promise<{ id: string; status: "draft" | "pending_approval" | "posted" }>;

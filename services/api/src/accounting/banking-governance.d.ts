import type { QueryClient } from "../index.js";
import type { AccountingContext, AccountingRecord } from "../accounting.js";

export class BankingGovernanceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}

export type BankStatementHealth = {
  readiness: "ready" | "attention" | "blocked";
  blockers: string[];
  warnings: string[];
  reconciliationEligible: boolean;
  closeEligible: boolean;
  riskBand: "low" | "medium" | "high";
  metrics: Record<string, number>;
};

export function evaluateBankStatementHealth(
  row: AccountingRecord,
  policyInput?: AccountingRecord,
  now?: Date,
): BankStatementHealth;

export function buildBankingGovernanceSummary(
  rows: AccountingRecord[],
  policyInput?: AccountingRecord,
  now?: Date,
): AccountingRecord;

export function getBankingGovernanceDashboard(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord>;

export function assessBankStatementReadiness(
  client: QueryClient,
  context: AccountingContext,
  statementId: string,
): Promise<AccountingRecord>;

export function captureBankingGovernanceSnapshot(
  client: QueryClient,
  context: AccountingContext,
  statementId: string,
  capturedFor?: string,
): Promise<AccountingRecord>;

export function getBankStatementGovernanceTimeline(
  client: QueryClient,
  context: AccountingContext,
  statementId: string,
): Promise<AccountingRecord[]>;

export function listBankingSavedViews(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord[]>;

export function saveBankingView(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function deleteBankingSavedView(
  client: QueryClient,
  context: AccountingContext,
  viewId: string,
): Promise<{ deleted: true; id: string }>;

export function upsertReconciliationExceptionCase(
  client: QueryClient,
  context: AccountingContext,
  statementId: string,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function bulkManageReconciliationExceptions(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function captureCashPositionSnapshot(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function captureCloseReadinessSnapshot(
  client: QueryClient,
  context: AccountingContext,
  companyId: string,
  fiscalPeriodId: string,
): Promise<AccountingRecord>;

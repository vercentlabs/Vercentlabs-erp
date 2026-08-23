import type { QueryClient } from "../../index.js";
import type { AccountingContext, AccountingRecord } from "./index.js";

export class TaxReportingGovernanceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}

export type TaxReturnHealth = {
  readiness: "ready" | "attention" | "blocked";
  riskBand: "low" | "medium" | "high";
  blockers: string[];
  warnings: string[];
  reviewEligible: boolean;
  filingEligible: boolean;
  metrics: Record<string, number>;
};

export function evaluateTaxReturnHealth(
  row: AccountingRecord,
  policyInput?: AccountingRecord,
  now?: Date,
): TaxReturnHealth;

export function buildTaxGovernanceSummary(
  rows: AccountingRecord[],
  policyInput?: AccountingRecord,
  now?: Date,
): AccountingRecord;

export function getTaxReportingGovernanceDashboard(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord>;

export function assessTaxReturnReadiness(
  client: QueryClient,
  context: AccountingContext,
  taxReturnId: string,
): Promise<AccountingRecord>;

export function captureTaxGovernanceSnapshot(
  client: QueryClient,
  context: AccountingContext,
  taxReturnId: string,
  capturedFor?: string,
): Promise<AccountingRecord>;

export function getTaxReturnGovernanceTimeline(
  client: QueryClient,
  context: AccountingContext,
  taxReturnId: string,
): Promise<AccountingRecord[]>;

export function listTaxSavedViews(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord[]>;

export function saveTaxView(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function deleteTaxSavedView(
  client: QueryClient,
  context: AccountingContext,
  viewId: string,
): Promise<{ deleted: true; id: string }>;

export function upsertTaxExceptionCase(
  client: QueryClient,
  context: AccountingContext,
  taxReturnId: string,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function bulkManageTaxExceptions(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function captureFinancialReportingSnapshot(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

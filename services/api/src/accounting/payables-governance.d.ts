import type { QueryClient } from "../index.js";
import type { AccountingContext, AccountingRecord } from "../accounting.js";

export class PayablesGovernanceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}

export type PayableHealth = {
  readiness: "ready" | "attention" | "blocked";
  blockers: string[];
  warnings: string[];
  isOpen: boolean;
  isOverdue: boolean;
  isDueSoon: boolean;
  paymentEligible: boolean;
  riskBand: string;
  metrics: Record<string, number | null>;
};

export function evaluatePayableHealth(
  row: AccountingRecord,
  policyInput?: AccountingRecord,
  now?: Date,
): PayableHealth;

export function buildPayablesGovernanceSummary(
  rows: AccountingRecord[],
  policyInput?: AccountingRecord,
  now?: Date,
): AccountingRecord;

export function getPayablesGovernanceDashboard(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord>;

export function assessVendorBillReadiness(
  client: QueryClient,
  context: AccountingContext,
  billId: string,
): Promise<AccountingRecord>;

export function capturePayablesGovernanceSnapshot(
  client: QueryClient,
  context: AccountingContext,
  billId: string,
  capturedFor?: string,
): Promise<AccountingRecord>;

export function getVendorBillGovernanceTimeline(
  client: QueryClient,
  context: AccountingContext,
  billId: string,
): Promise<AccountingRecord[]>;

export function listPayablesSavedViews(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord[]>;

export function savePayablesView(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function deletePayablesSavedView(
  client: QueryClient,
  context: AccountingContext,
  viewId: string,
): Promise<{ deleted: true; id: string }>;

export function upsertPayablesExceptionCase(
  client: QueryClient,
  context: AccountingContext,
  billId: string,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function bulkManagePayablesExceptions(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function listVendorPaymentProposals(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord[]>;

export function createVendorPaymentProposal(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function changeVendorPaymentProposalStatus(
  client: QueryClient,
  context: AccountingContext,
  proposalId: string,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function prepareVendorPaymentsFromProposal(
  client: QueryClient,
  context: AccountingContext,
  proposalId: string,
): Promise<AccountingRecord>;

export function refreshPayablesAging(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord>;

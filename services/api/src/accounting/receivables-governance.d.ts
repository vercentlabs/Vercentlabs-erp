import type { QueryClient } from "../index.js";
import type { AccountingContext, AccountingRecord } from "../accounting.js";

export class ReceivablesGovernanceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string);
}

export type ReceivablesHealth = {
  readiness: "ready" | "attention" | "blocked";
  blockers: string[];
  warnings: string[];
  isOpen: boolean;
  isOverdue: boolean;
  isDueSoon: boolean;
  collectionRequired: boolean;
  riskBand: "current" | "overdue" | "elevated" | "high";
  metrics: Record<string, number | null>;
};

export function evaluateReceivableHealth(
  row: AccountingRecord,
  policy?: AccountingRecord,
  now?: Date,
): ReceivablesHealth;

export function buildReceivablesGovernanceSummary(
  rows: AccountingRecord[],
  policy?: AccountingRecord,
  now?: Date,
): AccountingRecord;

export function getReceivablesGovernanceDashboard(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord>;

export function assessCustomerInvoiceReadiness(
  client: QueryClient,
  context: AccountingContext,
  invoiceId: string,
): Promise<AccountingRecord>;

export function captureReceivablesGovernanceSnapshot(
  client: QueryClient,
  context: AccountingContext,
  invoiceId: string,
  capturedFor?: string,
): Promise<AccountingRecord>;

export function getCustomerInvoiceGovernanceTimeline(
  client: QueryClient,
  context: AccountingContext,
  invoiceId: string,
): Promise<AccountingRecord[]>;

export function listReceivablesSavedViews(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord[]>;

export function saveReceivablesView(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function deleteReceivablesSavedView(
  client: QueryClient,
  context: AccountingContext,
  viewId: string,
): Promise<{ deleted: true; id: string }>;

export function upsertReceivablesCollectionCase(
  client: QueryClient,
  context: AccountingContext,
  invoiceId: string,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function bulkManageReceivablesCollections(
  client: QueryClient,
  context: AccountingContext,
  input?: AccountingRecord,
): Promise<AccountingRecord>;

export function refreshReceivablesAging(
  client: QueryClient,
  context: AccountingContext,
): Promise<AccountingRecord>;

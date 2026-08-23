import { SalesError } from "./index.js";
import type { SalesContext, SalesQueryClient } from "./index.js";

export class QuotationGovernanceError extends SalesError {
  readonly status: number;
  readonly code: string;
}

export type QuotationHealth = {
  healthy: boolean;
  readiness: "ready" | "attention" | "blocked";
  blockers: string[];
  warnings: string[];
  validForDays: number | null;
  inactiveDays: number;
  grandTotal: number;
  marginPercent?: number;
  maximumDiscount: number;
  readyToSubmit: boolean;
  readyToSend: boolean;
  readyToConvert: boolean;
};

export function evaluateQuotationHealth(
  row: Record<string, unknown>,
  policy?: Record<string, unknown>,
  now?: Date,
): QuotationHealth;

export function buildQuotationGovernanceSummary(
  rows: Array<Record<string, unknown>>,
  policy?: Record<string, unknown>,
  now?: Date,
): Record<string, unknown>;

export function getQuotationGovernanceDashboard(
  client: SalesQueryClient,
  context: SalesContext,
): Promise<Record<string, unknown>>;

export function assessQuotationReadiness(
  client: SalesQueryClient,
  context: SalesContext,
  quotationId: string,
): Promise<Record<string, unknown>>;

export function captureQuotationGovernanceSnapshot(
  client: SalesQueryClient,
  context: SalesContext,
  quotationId: string,
  capturedFor?: string,
): Promise<Record<string, unknown>>;

export function getQuotationGovernanceTimeline(
  client: SalesQueryClient,
  context: SalesContext,
  quotationId: string,
): Promise<Record<string, unknown>>;

export function compareQuotationVersions(
  client: SalesQueryClient,
  context: SalesContext,
  quotationId: string,
  leftVersionId: string,
  rightVersionId: string,
): Promise<Record<string, unknown>>;

export function bulkUpdateQuotations(
  client: SalesQueryClient,
  context: SalesContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function listQuotationSavedViews(
  client: SalesQueryClient,
  context: SalesContext,
): Promise<Array<Record<string, unknown>>>;

export function saveQuotationView(
  client: SalesQueryClient,
  context: SalesContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function deleteQuotationSavedView(
  client: SalesQueryClient,
  context: SalesContext,
  savedViewId: string,
): Promise<Record<string, unknown>>;

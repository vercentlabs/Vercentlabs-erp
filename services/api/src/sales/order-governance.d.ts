import { SalesError } from "../sales.js";
import type { SalesContext, SalesQueryClient } from "../sales.js";

export class SalesOrderGovernanceError extends SalesError {
  readonly status: number;
  readonly code: string;
}

export type SalesOrderHealth = {
  healthy: boolean;
  readiness: "ready" | "attention" | "blocked";
  blockers: string[];
  warnings: string[];
  deliveryDays: number | null;
  inactiveDays: number;
  confirmedAgeHours: number;
  grandTotal: number;
  remainingToFulfill: number;
  remainingToInvoice: number;
  reservedQuantity: number;
  fulfilledQuantity: number;
  readyToSubmit: boolean;
  readyToConfirm: boolean;
  readyToFulfill: boolean;
  readyToInvoice: boolean;
  readyToClose: boolean;
};

export function evaluateSalesOrderHealth(
  row: Record<string, unknown>,
  policy?: Record<string, unknown>,
  now?: Date,
): SalesOrderHealth;

export function buildSalesOrderGovernanceSummary(
  rows: Array<Record<string, unknown>>,
  policy?: Record<string, unknown>,
  now?: Date,
): Record<string, unknown>;

export function getSalesOrderGovernanceDashboard(
  client: SalesQueryClient,
  context: SalesContext,
): Promise<Record<string, unknown>>;

export function assessSalesOrderReadiness(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
): Promise<Record<string, unknown>>;

export function captureSalesOrderGovernanceSnapshot(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  capturedFor?: string,
): Promise<Record<string, unknown>>;

export function getSalesOrderGovernanceTimeline(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
): Promise<Record<string, unknown>>;

export function compareSalesOrderVersions(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  leftVersionId: string,
  rightVersionId: string,
): Promise<Record<string, unknown>>;

export function bulkUpdateSalesOrders(
  client: SalesQueryClient,
  context: SalesContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function reserveSalesOrderLines(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function createSalesReturnRequest(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function listSalesOrderSavedViews(
  client: SalesQueryClient,
  context: SalesContext,
): Promise<Array<Record<string, unknown>>>;

export function saveSalesOrderView(
  client: SalesQueryClient,
  context: SalesContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;

export function deleteSalesOrderSavedView(
  client: SalesQueryClient,
  context: SalesContext,
  savedViewId: string,
): Promise<Record<string, unknown>>;

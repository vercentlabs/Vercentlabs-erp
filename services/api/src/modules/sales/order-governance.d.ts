import { SalesError } from "./index.js";
import type { SalesContext, SalesQueryClient } from "./index.js";

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

export function assessSalesOrderReadiness(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
): Promise<Record<string, unknown>>;

export function closeSalesOrder(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
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

export function reserveSalesOrderLines(
  client: SalesQueryClient,
  context: SalesContext,
  orderId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;


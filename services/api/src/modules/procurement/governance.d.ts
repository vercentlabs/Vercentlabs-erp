import type {
  ProcurementClient,
  ProcurementContext,
} from "./index.js";
export type ProcurementGovernanceHealth = {
  readiness: "ready" | "attention" | "blocked";
  riskBand: "low" | "medium" | "high";
  blockers: string[];
  warnings: string[];
  metrics: Record<string, unknown>;
};
export declare class ProcurementGovernanceError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}
export declare function evaluateSupplierGovernance(
  row: Record<string, any>,
  policy?: Record<string, any>,
  now?: Date,
): ProcurementGovernanceHealth;
export declare function evaluatePurchaseOrderHealth(
  row: Record<string, any>,
  policy?: Record<string, any>,
  now?: Date,
): ProcurementGovernanceHealth;
export declare function evaluateReceiptHealth(
  row: Record<string, any>,
  policy?: Record<string, any>,
): ProcurementGovernanceHealth;
export declare function buildProcurementGovernanceSummary(
  groups: Record<string, Array<Record<string, any>>>,
): Record<string, number>;
export declare function assessProcurementRecordReadiness(
  client: ProcurementClient,
  context: ProcurementContext,
  entityType: string,
  entityId: string,
): Promise<Record<string, any>>;
export declare function getProcurementGovernanceTimeline(
  client: ProcurementClient,
  context: ProcurementContext,
  entityType: string,
  entityId: string,
): Promise<Array<Record<string, any>>>;

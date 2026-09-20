import type { ManufacturingContext } from "./engineering.js";
type Row = Record<string, any>;
export declare function getStandardCost(client: any, context: ManufacturingContext, input?: Row): Promise<Row>;
export declare function getProductionCostReport(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function getVarianceReport(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function getYieldReport(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function getEfficiencyReport(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { centers: Row[] }>;
export declare function getProductionSummary(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function getProductionDashboard(client: any, context: ManufacturingContext): Promise<Row>;

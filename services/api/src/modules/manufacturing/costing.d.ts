import type { ManufacturingContext } from "./engineering.js";
type Row = Record<string, any>;
export declare function getStandardCost(client: any, context: ManufacturingContext, input?: Row): Promise<Row>;
export declare function getProductionCostReport(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function getVarianceReport(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function getProductionDashboard(client: any, context: ManufacturingContext): Promise<Row>;

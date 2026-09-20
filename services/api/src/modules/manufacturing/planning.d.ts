import type { ManufacturingContext } from "./engineering.js";
type Row = Record<string, any>;
export declare function runMrp(client: any, context: ManufacturingContext, input?: Row): Promise<Row>;
export declare function listMrpRuns(client: any, context: ManufacturingContext): Promise<Row[]>;
export declare function getMrpRun(client: any, context: ManufacturingContext, runId: string): Promise<Row & { requirements: Row[] }>;
export declare function createOrdersFromMrp(client: any, context: ManufacturingContext, runId: string, input?: Row): Promise<{ runId: string; created: Row[] }>;
export declare function getMaterialAvailability(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;
export declare function scheduleProductionOrders(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { orders: Row[] }>;

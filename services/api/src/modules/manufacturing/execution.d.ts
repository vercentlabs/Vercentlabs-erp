import type { ManufacturingContext } from "./engineering.js";
type Row = Record<string, any>;
export declare function holdProductionOrder(client: any, context: ManufacturingContext, id: string, reason?: string): Promise<Row>;
export declare function resumeProductionOrder(client: any, context: ManufacturingContext, id: string, note?: string): Promise<Row>;
export declare function recordInspection(client: any, context: ManufacturingContext, workOrderId: string, input?: Row): Promise<Row>;
export declare function listManufacturingInspections(client: any, context: ManufacturingContext, options?: { limit?: number }): Promise<Row[]>;

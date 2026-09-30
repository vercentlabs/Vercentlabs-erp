import type { ManufacturingContext } from "./engineering.js";
type Row = Record<string, any>;
export declare function getMaterialAvailability(client: any, context: ManufacturingContext, input?: Row): Promise<Row & { lines: Row[] }>;

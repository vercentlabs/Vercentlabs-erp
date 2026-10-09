import type { StockContext } from "./index.js";
type Row = Record<string, unknown>;
export declare function getStockSettings(client: any, context: StockContext): Promise<Row>;
export declare function updateStockSettings(client: any, context: StockContext, input?: Row): Promise<Row>;
export declare function createStockBatch(client: any, context: StockContext, input?: Row): Promise<Row>;
export declare function setStockBatchStatus(client: any, context: StockContext, batchId: string, status: string, reason?: string): Promise<Row>;
export declare function receiveSerializedStock(client: any, context: StockContext, input?: Row): Promise<{ movement: Row; serials: Row[]; replayed: boolean }>;

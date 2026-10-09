import type { StockContext } from "./index.js";
type Client = any;
export declare function getBatchDetail(client: Client, context: StockContext, batchId: string): Promise<Record<string, unknown>>;
export declare function getSerialDetail(client: Client, context: StockContext, serialId: string): Promise<Record<string, unknown>>;

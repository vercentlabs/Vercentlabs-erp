import type { StockContext } from "./index.js";
type Row = Record<string, unknown>;
export declare function listStockQuarantine(client: any, context: StockContext): Promise<{ holds: Row[]; located: Row[] }>;

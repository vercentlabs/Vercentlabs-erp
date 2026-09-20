import type { StockContext } from "./index.js";
type Row = Record<string, unknown>;
export declare const DAMAGE_CATEGORIES: string[];
export declare function getStockTraceability(client: any, context: StockContext, input?: { code?: string }): Promise<{ kind: "batch" | "serial"; subject: Row; movements: Row[]; balances: Row[]; holds: Row[]; summary: Row }>;
export declare function listStockQuarantine(client: any, context: StockContext): Promise<{ holds: Row[]; located: Row[] }>;
export declare function recordDamagedStock(client: any, context: StockContext, input?: Row): Promise<Row>;
export declare function recordStockReturn(client: any, context: StockContext, input?: Row): Promise<Row>;

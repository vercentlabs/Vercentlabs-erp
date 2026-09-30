import type { StockContext } from "./index.js";
type Row = Record<string, unknown>;
export declare function getStockValuationReport(client: any, context: StockContext, options?: { warehouseId?: string | null; groupId?: string | null }): Promise<{ lines: Row[]; totals: { stockValue: string; byMethod: Record<string, string> } }>;
export declare function getStockMovementSummary(client: any, context: StockContext, options?: { from?: string | null; to?: string | null; warehouseId?: string | null }): Promise<{ lines: Row[] }>;

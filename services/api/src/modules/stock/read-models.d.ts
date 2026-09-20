import type { StockContext } from "./index.js";
type Row = Record<string, unknown>;
export declare function listStockBalancesDetailed(client: any, context: StockContext, options?: { itemId?: string | null; warehouseId?: string | null; search?: string; limit?: number }): Promise<Row[]>;
export declare function listStockLedger(client: any, context: StockContext, options?: { itemId?: string | null; warehouseId?: string | null; movementType?: string | null; referenceType?: string | null; referenceId?: string | null; limit?: number }): Promise<Row[]>;
export declare function listStockTransfersDetailed(client: any, context: StockContext, options?: { status?: string | null; limit?: number }): Promise<Row[]>;
export declare function listStockReservationsDetailed(client: any, context: StockContext, options?: { status?: string | null; limit?: number }): Promise<Row[]>;

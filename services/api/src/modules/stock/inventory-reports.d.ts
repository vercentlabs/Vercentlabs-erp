import type { StockContext } from "./index.js";
type Client = any;
type Row = Record<string, unknown>;
export declare const INVENTORY_REPORTS: ReadonlyArray<{ key: string; title: string; description: string; permission: string }>;
export declare function getInventoryReportCatalog(context: StockContext): Array<{ key: string; title: string; description: string }>;
export declare function getInventoryReport(client: Client, context: StockContext, key: string, filters?: Row): Promise<Row>;
export declare function exportInventoryReport(client: Client, context: StockContext, key: string, filters?: Row, format?: "csv" | "xlsx"): Promise<{ fileName: string; contentType: string; body: string | Uint8Array; rowCount: number }>;

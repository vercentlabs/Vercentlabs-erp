// Purchase analysis (Procurement report Phase 3).
export type PurchaseAnalysis = { from: string; to: string; rowsBy: string; columnsBy: string | null; measure: string; measureLabel: string; total: number; truncated: boolean;
  dimensions: Array<{ key: string; label: string }>; measures: Array<{ key: string; label: string }>;
  rows: Array<{ key: string; label: string; total: number }>; columns: Array<{ key: string; label: string; total: number }>; cells: Record<string, Record<string, number>> };
type Options = { rows?: string; columns?: string | null; measure?: string; from?: string; to?: string };
export declare const PURCHASE_ANALYSIS_DIMENSIONS: Record<string, { label: string; key: string; name: string }>;
export declare const PURCHASE_ANALYSIS_MEASURES: Record<string, { label: string; sql: string }>;
export declare function getPurchaseAnalysis(client: any, context: any, options?: Options): Promise<PurchaseAnalysis>;
export declare function exportPurchaseAnalysis(client: any, context: any, options?: Options): Promise<{ fileName: string; body: Buffer }>;

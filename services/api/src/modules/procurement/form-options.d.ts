/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export declare function listProcurementFormOptions(client: Client, context: any, include?: { supplierIds?: string | string[]; itemIds?: string | string[] }): Promise<Record<string, any[]>>;
// The pickers' search (options.js): suppliers or purchasable items, a first page plus `ids`, or the matches for `search`.
export declare function searchProcurementOptions(client: Client, context: any, input: {
  kind: string; search?: string; ids?: string | string[]; supplierId?: string | null; activeOnly?: boolean;
}): Promise<{ suppliers?: any[]; products?: any[] }>;

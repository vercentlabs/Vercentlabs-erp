// Supplier Rates (Procurement report H1).
type Row = Record<string, any>;
export declare const SUPPLIER_RATE_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export declare const SUPPLIER_RATE_IMPORT_COLUMNS: ReadonlyArray<{ key: string; label: string; hint?: string }>;
export declare function listSupplierRates(client: any, context: any, filters?: Row): Promise<Row[] | { rows: Row[]; total: number; limit: number; offset: number }>;
export declare function getSupplierRate(client: any, context: any, rateId: string): Promise<{ rate: Row; actions: { edit: boolean } }>;
export declare function createSupplierRate(client: any, context: any, input?: Row): Promise<{ id: string }>;
export declare function updateSupplierRate(client: any, context: any, rateId: string, input?: Row): Promise<{ id: string }>;
export declare function setSupplierRateActive(client: any, context: any, rateId: string, active: boolean): Promise<{ id: string; status: string }>;
export declare function supplierRateFor(client: any, organizationId: string, input: Row): Promise<Row | null>;
export declare function preferredSupplierRate(client: any, organizationId: string, itemId: string, date: string): Promise<Row | null>;
export declare function listRatesForSupplier(client: any, context: any, supplierId: string, filters?: Row): Promise<Row[] | { rows: Row[]; total: number; limit: number; offset: number }>;
export declare function importSupplierRates(client: any, context: any, input: { bytes: Uint8Array | Buffer; fileName: string; dryRun?: boolean }): Promise<{ rows: number; created: number; updated: number; errors: Array<{ row: number; message: string }>; dryRun: boolean }>;
export declare function fillSupplierRatesFromOrders(client: any, context: any, input?: { months?: number }): Promise<{ created: number }>;

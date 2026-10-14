// Manufacturing from Sales demand (0113).
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Ctx = { organizationId: string; userId: string; permissions: string[]; roleSlugs: string[] };
type Rec = Record<string, unknown>;
export declare const DEMAND_PERMISSIONS: Readonly<Record<string, string>>;
export declare class DemandError extends Error { readonly status: number; readonly code: string; readonly details?: Rec }
export declare function listSalesDemand(client: Client, c: Ctx, filters?: Rec): Promise<any>;
export declare function getSalesDemand(client: Client, c: Ctx, id: string): Promise<any>;
export declare function previewManufacturingFromSales(client: Client, c: Ctx, input: Rec): Promise<any>;
export declare function createManufacturingOrderFromSales(client: Client, c: Ctx, input: Rec): Promise<any>;
export declare function allocateManufacturingSupply(client: Client, c: Ctx, input: Rec): Promise<any>;
export declare function releaseManufacturingAllocation(client: Client, c: Ctx, allocationId: string, input: Rec): Promise<any>;
export declare function reassignManufacturingSupply(client: Client, c: Ctx, allocationId: string, input: Rec): Promise<any>;
export declare function reserveDemandForSales(client: Client, c: Ctx, id: string, input?: Rec): Promise<any>;
export declare function attributeReceiptToDemand(client: Client, c: Ctx, order: Rec, receiptId: string, quantity: string): Promise<any>;
export declare function setManufacturingItemPolicy(client: Client, c: Ctx, itemId: string, input: Rec): Promise<any>;
export declare function getDemandReport(client: Client, c: Ctx, kind?: string): Promise<any[]>;
export declare function getSalesManufacturingProgress(client: Client, c: Ctx, salesOrderId: string): Promise<any>;

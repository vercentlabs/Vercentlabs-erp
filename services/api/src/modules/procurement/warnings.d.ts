// Purchase warnings (report Phase 3).
export declare function setSupplierPurchaseWarning(client: any, context: any, supplierId: string, input?: { message?: string | null }): Promise<{ message: string | null }>;
export declare function setItemPurchaseWarning(client: any, context: any, itemId: string, input?: { level?: string; message?: string | null }): Promise<{ level: string; message: string | null }>;
export declare function purchaseWarningsFor(client: any, organizationId: string, input: { supplierId?: string | null; lines?: Array<{ itemId: string | null; label?: string; carried?: boolean }> }): Promise<Array<{ line: number | null; code: string; message: string }>>;
export declare function setItemPurchaseBillBasis(client: any, context: any, itemId: string, input?: { basis?: string | null }): Promise<{ basis: string | null }>;

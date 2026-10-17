// Assets — Purchase Invoice-to-Asset Creation (types for the web).
type Client = any;
type Ctx = { organizationId: string; userId: string; permissions: readonly string[]; roleSlugs: readonly string[] };
export declare const ASSET_INVOICE_PERMISSIONS: Readonly<Record<string, string>>;
export declare const ASSET_INVOICE_MESSAGES: Readonly<Record<string, string>>;
export declare const ASSET_INVOICE_REPORTS: readonly string[];
export declare function createAssetsFromInvoice(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function previewAssetsFromInvoice(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function exportInvoiceRegistration(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getInvoiceExceptions(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getInvoiceReconciliation(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getInvoiceRegistrationBatch(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getInvoiceReport(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getInvoiceSource(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function listEligibleInvoices(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function listInvoiceRegistrationBatches(client: Client, c: Ctx, ...args: any[]): Promise<any>;

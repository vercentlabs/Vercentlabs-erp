// Assets — the dashboard, the exceptions and reconciliation center, and asset search (types for the web).
type Client = any;
type Ctx = { organizationId: string; userId: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };
export declare function getAssetsControlCenter(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getAssetsDashboard(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function searchAssets(client: Client, c: Ctx, ...args: any[]): Promise<any>;

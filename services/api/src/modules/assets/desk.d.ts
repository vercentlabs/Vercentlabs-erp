export type AssetDeskContext = { organizationId: string; userId: string; permissions: readonly string[]; roleSlugs: readonly string[] };
export declare class AssetError extends Error { status: number; code: string; constructor(status: number, message: string, code?: string); }
export declare function assetsContext(session: Record<string, unknown>): AssetDeskContext;
export declare function getAssetSettings(client: any, context: AssetDeskContext, ...args: any[]): Promise<any>;
export declare function listAssetAssignments(client: any, context: AssetDeskContext, ...args: any[]): Promise<any>;
export declare function listAssetOptions(client: any, context: AssetDeskContext, ...args: any[]): Promise<any>;
export declare function saveAssetSettings(client: any, context: AssetDeskContext, ...args: any[]): Promise<any>;

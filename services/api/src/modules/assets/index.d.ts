export type AssetsContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getAssetsDashboard(client: any, context: AssetsContext): Promise<any>;
export declare function listAssetResource(client: any, context: AssetsContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function createManagedAssetCategory(client: any, context: AssetsContext, input: Record<string, any>): Promise<any>;
export declare function createManagedAsset(client: any, context: AssetsContext, input: Record<string, any>): Promise<any>;
export declare function capitalizeManagedAsset(client: any, context: AssetsContext, assetId: string, input?: Record<string, any>): Promise<any>;
export declare function assignAsset(client: any, context: AssetsContext, assetId: string, input: Record<string, any>): Promise<any>;
export declare function createMaintenanceOrder(client: any, context: AssetsContext, assetId: string, input: Record<string, any>): Promise<any>;
export declare function completeMaintenanceOrder(client: any, context: AssetsContext, orderId: string, input: Record<string, any>): Promise<any>;
export declare function disposeManagedAsset(client: any, context: AssetsContext, assetId: string, input: Record<string, any>): Promise<any>;

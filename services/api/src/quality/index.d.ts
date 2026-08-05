export type QualityContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getQualityDashboard(client: any, context: QualityContext): Promise<any>;
export declare function listQualityResource(client: any, context: QualityContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function createQualityPlan(client: any, context: QualityContext, input: Record<string, any>): Promise<any>;
export declare function createInspection(client: any, context: QualityContext, input: Record<string, any>): Promise<any>;
export declare function completeInspection(client: any, context: QualityContext, inspectionId: string, input: Record<string, any>): Promise<any>;
export declare function releaseInspection(client: any, context: QualityContext, inspectionId: string, input?: Record<string, any>): Promise<any>;
export declare function createNonconformance(client: any, context: QualityContext, input: Record<string, any>): Promise<any>;
export declare function createCapa(client: any, context: QualityContext, input: Record<string, any>): Promise<any>;

export declare class ConfigurationError extends Error {
  status: number;
}
export declare function getEffectiveConfiguration(client: any, organizationId: string, namespace: string, key: string, at?: Date): Promise<any | null>;
export declare function listConfigurationVersions(client: any, organizationId: string, namespace?: string): Promise<any[]>;
export declare function writeConfigurationVersion(client: any, session: any, input: any): Promise<any>;
export declare function setFeatureFlag(client: any, session: any, input: any): Promise<any>;
export declare function listFeatureFlags(client: any, organizationId: string): Promise<any[]>;
export declare function isFeatureFlagEnabled(client: any, organizationId: string, flagKey: string, context?: { roleSlugs?: string[]; userId?: string }): Promise<boolean>;

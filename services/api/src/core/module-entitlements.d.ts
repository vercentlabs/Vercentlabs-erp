import type { ErpModule } from "@vercentlabs/shared-types";

export type ModuleAccessReason = "not_released" | "disabled" | "not_entitled" | "not_permitted";
export type ModuleAccess = {
  moduleId: string;
  name: string;
  released: boolean;
  enabled: boolean;
  entitled: boolean;
  permitted: boolean;
  accessible: boolean;
  reason?: ModuleAccessReason;
};
export declare function getModuleDefinition(moduleId: string): ErpModule | null;
export declare function isModuleReleased(moduleId: string): boolean;
export declare function getEnabledModuleKeys(client: any, organizationId: string): Promise<Set<string>>;
export declare function isModuleEnabledForTenant(moduleId: string, enabledModuleKeys: ReadonlySet<string>): boolean;
export declare function isModuleEntitled(client: any, organizationId: string, moduleId: string, env?: any): Promise<{ entitled: boolean; enforced: boolean }>;
export declare function isModulePermitted(session: any, moduleId: string): boolean;
export declare function resolveModuleAccess(client: any, session: any, moduleId: string, options?: { enabledModuleKeys?: ReadonlySet<string> }, env?: any): Promise<ModuleAccess>;
export declare function canUserAccessModule(client: any, session: any, moduleId: string, env?: any): Promise<boolean>;
export declare class ModuleAccessError extends Error {
  status: number;
  code: string;
}
export declare function assertModuleAccessible(client: any, session: any, moduleId: string, env?: any): Promise<void>;
export declare function getAccessibleModules(client: any, session: any, env?: any): Promise<ModuleAccess[]>;
export declare const PERMISSIONS: Record<string, string>;

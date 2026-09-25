export declare class ModuleAdministrationError extends Error {
  status: number;
  code: string;
}
export type ModuleAdministrationEntry = {
  key: string;
  name: string;
  description: string;
  released: boolean;
  enabled: boolean;
  planIncluded: boolean;
  entitlementEnforced: boolean;
  availableToWorkspace: boolean;
  actorHasViewPermission: boolean;
};
export declare function listModuleAdministration(client: any, session: any, env?: any): Promise<ModuleAdministrationEntry[]>;
export declare function setOrganizationModuleEnabled(
  client: any,
  session: any,
  moduleKey: string,
  enabled: boolean,
  options?: { request?: Request; env?: any },
): Promise<{ module: ModuleAdministrationEntry | undefined; changed: boolean }>;

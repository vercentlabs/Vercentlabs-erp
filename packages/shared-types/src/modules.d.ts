export type ErpModuleAvailability = "released" | "roadmap";
export type ErpModule = Readonly<{
  key: string;
  name: string;
  description: string;
  availability: ErpModuleAvailability;
}>;
export const ERP_MODULE_CATALOG: readonly ErpModule[];
export const RELEASED_MODULE_KEYS: readonly string[];
export const ROADMAP_MODULE_KEYS: readonly string[];
export function getErpModule(key: string): ErpModule | null;
export function isReleasedModule(key: string): boolean;

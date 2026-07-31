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
export const TOTAL_MODULE_COUNT: number;
export const RELEASED_MODULE_COUNT: number;
export const ROADMAP_MODULE_COUNT: number;
export const RELEASED_MODULE_NAMES: readonly string[];
export const RELEASE_STAGE: "controlled-early-access";
export const NATIVE_OPERATIONAL_MODULE_KEYS: readonly ["crm", "procurement"];
export function getErpModule(key: string): ErpModule | null;
export function isReleasedModule(key: string): boolean;

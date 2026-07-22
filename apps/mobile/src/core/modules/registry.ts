import { crmManifest } from "@/modules/crm/manifest";
import type { NativeModuleManifest } from "./types";

const manifests: readonly NativeModuleManifest[] = [crmManifest];

export function releasedModules(permissions: readonly string[]) {
  const allowed = new Set(permissions);
  return manifests.filter((module) => module.released && (!module.permission || allowed.has(module.permission)));
}

export function moduleByKey(key: string) {
  return manifests.find((module) => module.key === key);
}

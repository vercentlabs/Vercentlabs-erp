import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import { ERP_MODULE_CATALOG, NATIVE_OPERATIONAL_MODULE_KEYS } from "@vercentlabs/shared-types";

export type MobileModule = {
  key: string;
  name: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  href?: "/(protected)/crm" | "/(protected)/workspace/procurement";
  permission?: string;
  enabled: boolean;
};

const icons: Record<string, ComponentProps<typeof Ionicons>["name"]> = {
  accounting: "calculator-outline", procurement: "cart-outline", sales: "receipt-outline",
  crm: "people-outline", stock: "cube-outline", manufacturing: "construct-outline",
  projects: "folder-open-outline", assets: "business-outline", "point-of-sale": "storefront-outline",
  quality: "shield-checkmark-outline", support: "headset-outline", "hr-payroll": "id-card-outline",
};

export const mobileModules: readonly MobileModule[] = ERP_MODULE_CATALOG.map((module) => ({
  key: module.key,
  name: module.name,
  description: module.description,
  icon: icons[module.key] ?? "apps-outline",
  href: module.key === "crm" ? "/(protected)/crm" : module.key === "procurement" ? "/(protected)/workspace/procurement" : undefined,
  permission: module.key === "crm" ? "crm.view" : module.key === "procurement" ? "procurement.view" : undefined,
  enabled: module.availability === "released" && (NATIVE_OPERATIONAL_MODULE_KEYS as readonly string[]).includes(module.key),
}));

export function availableModules(permissions: readonly string[]) {
  const allowed = new Set(permissions);
  return mobileModules.filter((module) => module.enabled && (!module.permission || allowed.has(module.permission)));
}


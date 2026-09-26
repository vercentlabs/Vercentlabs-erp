import type { ComponentType, SVGProps } from "react";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

// Explicit per Phase 2: a normal production nav item may only ever be
// AVAILABLE (a real, reachable screen) or ADMIN_ONLY (real, permission-
// gated). PLANNED items are real future destinations the registry already
// knows the route/label/section for, but the secondary sidebar renders
// them disabled — visible for orientation, never clickable, never a 404.
// UNAVAILABLE covers a destination whose owning module itself isn't
// entitled/permitted (resolved at render time from module-entitlements,
// not stored per item).
export type NavImplementationStatus = "AVAILABLE" | "PLANNED" | "ADMIN_ONLY";

export type SecondaryNavItem = {
  id: string;
  label: string;
  route: string;
  status: NavImplementationStatus;
  /** Base permission required once implemented — checked only when status is AVAILABLE/ADMIN_ONLY. */
  requiredPermission?: string;
  aliases?: string[];
};

export type SecondaryNavSection = {
  id: string;
  label: string;
  /** Coarse F-id range this section maps to, for traceability back to docs/02-register/FEATURE_REGISTER.csv — see that module's row group. Not a claim that every item is 1:1 with one F-id. */
  featureRange?: string;
  items: SecondaryNavItem[];
};

export type ModuleNavigation = {
  moduleKey: string;
  label: string;
  icon: NavIcon;
  /** The module's base view permission, matching services/api/src/core/access/module-entitlements.js. */
  requiredPermission: string;
  sections: SecondaryNavSection[];
};

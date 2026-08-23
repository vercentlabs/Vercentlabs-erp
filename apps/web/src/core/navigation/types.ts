// Canonical typed shape for every navigation source in apps/web. Extracted
// from apps/web/src/core/components/app-shell.tsx (Prompt 1's audit: "one typed
// config, not scattered JSX" — this registry formalizes that, it does not
// invent a new pattern). See docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md.
import type { AppIconName } from "@/shared/components/app-icon";

// Deliberately a local, exhaustive-checkable union — packages/shared-types's
// ErpModule.key is plain `string` (see modules.d.ts), so this is the
// navigation layer's own stricter view of the same 12 canonical keys
// resolveModuleAccess() already accepts. Keep in sync with
// ERP_MODULE_CATALOG; navigation-registry.test.mjs enforces that.
export type ModuleId =
  | "crm"
  | "sales"
  | "accounting"
  | "procurement"
  | "stock"
  | "manufacturing"
  | "projects"
  | "assets"
  | "point-of-sale"
  | "quality"
  | "support"
  | "hr-payroll";

export type NavigationItem = {
  href: string;
  label: string;
  icon: AppIconName;
  /** Base permission string (from PERMISSIONS) gating this destination. Absent = visible to any authenticated workspace member. */
  permission?: string;
  /** Exact-path match only (no startsWith prefix matching). */
  exact?: boolean;
  /** Sub-heading rendered above this item when it differs from the previous item's group. */
  group?: string;
  /** Additional path prefixes that should also count as "active" for this item (legacy/renamed routes). */
  activePrefixes?: string[];
  badge?: number;
  /** Search-only aliases/synonyms (Prompt 7's command palette) — never rendered, only matched against. Added sparingly, only where a real naming gap exists (e.g. "POS" for Point of Sale); most items don't need any. */
  keywords?: string[];
};

export type ModuleNavigationGroup = {
  moduleId: ModuleId;
  label: string;
  icon: AppIconName;
  /** Search-only aliases for the module itself (Part 28 — "crm", "inventory" -> Stock, etc). */
  keywords?: string[];
  items: NavigationItem[];
};

export type NavigationSectionData = {
  id: string;
  label: string;
  items: NavigationItem[];
};

// The fully server-resolved, rendering-ready shape AppShell consumes —
// produced once per request by resolve-navigation.ts's resolveNavigation().
// Everything unauthorized has already been removed; AppShell never
// re-derives visibility client-side (Part 9's "filter before render").
export type ResolvedNavigation = {
  workspace: NavigationItem[];
  modules: ModuleNavigationGroup[];
  myWork: NavigationItem[];
  governance: NavigationItem[];
  administration: NavigationItem[];
};

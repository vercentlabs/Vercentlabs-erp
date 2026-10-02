import type { ComponentType, SVGProps } from "react";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

// A normal production nav item may only ever be
// AVAILABLE (a real, reachable screen) or ADMIN_ONLY (real, permission-
// gated). PLANNED items are real future destinations the registry already
// knows the route/label/section for, but the secondary sidebar renders
// them disabled — visible for orientation, never clickable, never a 404.
// UNAVAILABLE covers a destination whose owning module itself isn't
// entitled/permitted (resolved at render time from module-entitlements,
// not stored per item).
type NavImplementationStatus = "AVAILABLE" | "PLANNED" | "ADMIN_ONLY";

// ROUTE EXISTENCE != PERMANENT SIDEBAR DESTINATION. Every real route stays
// registered here (breadcrumbs, route matching, global search, deep links),
// but only a module's workspaces are permanent secondary-sidebar entries.
// A route that is a view, feature or configuration page inside a workspace
// is registered with `parent` (the workspace item it belongs to): it never
// renders in the sidebar, it is still searchable, and while it is open the
// sidebar highlights its parent. Before adding a sidebar item, ask: "is this
// a distinct recurring workspace, or a view/action/configuration inside an
// existing one?" — see apps/web/src/shell/navigation/navigation.test.ts.
export type SecondaryNavItem = {
  id: string;
  label: string;
  route: string;
  status: NavImplementationStatus;
  /** Base permission required once implemented — checked only when status is AVAILABLE/ADMIN_ONLY. */
  requiredPermission?: string;
  /** Visible when the person holds ANY of these (instead of one requiredPermission) — e.g. a hub whose destinations are guarded by different permissions. */
  requiredAnyPermission?: string[];
  aliases?: string[];
  /** Id of the workspace item (same module) this route belongs to. Set = not a sidebar item. */
  parent?: string;
  /** Group inside the parent workspace (e.g. a CRM Setup category), for breadcrumbs, search and the workspace's own content navigation. */
  group?: string;
  /** One task-oriented line, shown where the item is offered as a destination card. */
  description?: string;
};

type SecondaryNavSection = {
  id: string;
  label: string;
  /** Coarse F-id range this section maps to, for traceability. Not a claim that every item is 1:1 with one F-id. */
  featureRange?: string;
  items: SecondaryNavItem[];
};

/** A group of child destinations inside a workspace (e.g. "Routing & organization" in CRM Setup). */
export type WorkspaceGroup = {
  id: string;
  /** The workspace item id this group belongs to. */
  workspace: string;
  label: string;
  description: string;
  icon: NavIcon;
};

export type ModuleNavigation = {
  moduleKey: string;
  label: string;
  icon: NavIcon;
  /** The module's base view permission, matching services/api/src/core/access/module-entitlements.js. */
  requiredPermission: string;
  sections: SecondaryNavSection[];
  groups?: WorkspaceGroup[];
};

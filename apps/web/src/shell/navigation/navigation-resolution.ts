// Pure route-ownership rules over the canonical registry
// (module-navigation-registry.ts). The desktop secondary sidebar, the mobile
// drawer, breadcrumbs, global search and workspace hubs all resolve through
// these functions, so "which workspace owns this route" is decided once.
import type {
  ModuleNavigation,
  NavIcon,
  SecondaryNavItem,
  WorkspaceGroup,
} from "./navigation-types";

type SecondaryNavSectionIcon = NavIcon;

export type NavViewer = {
  permissions: readonly string[];
  /** organization_owner sees every destination, as it does server-side. */
  isOwner?: boolean;
};

// A route may carry a query (a tab or view of one page, e.g. /inventory/replenishment?tab=alerts): it matches on its path; the query only
// decides which of several items sharing that path is active.
const pathOf = (route: string) => route.split("?")[0];
const queryOf = (route: string) => new URLSearchParams(route.includes("?") ? route.slice(route.indexOf("?") + 1) : "");

export function matchesRoute(pathname: string, route: string): boolean {
  const path = pathOf(route);
  return pathname === path || pathname.startsWith(`${path}/`);
}

// How well an item's query fits the current one: every parameter it names present with the same value (−1 if not; more named = better).
function queryFit(route: string, search: string): number {
  const wanted = queryOf(route);
  const current = new URLSearchParams(search);
  let fit = 0;
  for (const [key, value] of wanted) {
    if (current.get(key) !== value) return -1;
    fit += 1;
  }
  return fit;
}

export function allItems(module: ModuleNavigation): SecondaryNavItem[] {
  return module.sections.flatMap((section) => section.items);
}

/** A permanent sidebar workspace (not a view/feature/configuration inside one). */
function isSidebarItem(item: SecondaryNavItem): boolean {
  return !item.parent;
}

export function isItemPermitted(
  item: SecondaryNavItem,
  viewer: NavViewer,
): boolean {
  if (viewer.isOwner) return true;
  if (item.requiredAnyPermission?.length)
    return item.requiredAnyPermission.some((permission) =>
      viewer.permissions.includes(permission),
    );
  return (
    !item.requiredPermission ||
    viewer.permissions.includes(item.requiredPermission)
  );
}

/** The most specific registered route (visible or not) matching the path. */
export function matchRoute(
  module: ModuleNavigation,
  pathname: string,
  search = "",
): SecondaryNavItem | undefined {
  let best: SecondaryNavItem | undefined;
  let bestFit = -2;
  for (const item of allItems(module)) {
    if (item.status !== "AVAILABLE") continue;
    if (!matchesRoute(pathname, item.route)) continue;
    const fit = queryFit(item.route, search);
    const length = pathOf(item.route).length;
    const bestLength = best ? pathOf(best.route).length : -1;
    // The longest path wins; among items of the same path, the one whose query fits best (an unfitting query only when nothing fits).
    if (!best || length > bestLength || (length === bestLength && fit > bestFit)) { best = item; bestFit = fit; }
  }
  return best;
}

/** The sidebar workspace that owns an item (itself when it is one). */
export function owningWorkspace(
  module: ModuleNavigation,
  item: SecondaryNavItem,
): SecondaryNavItem {
  if (!item.parent) return item;
  return (
    allItems(module).find((candidate) => candidate.id === item.parent) ?? item
  );
}

/** Which permanent sidebar item is active for a path — exactly one or none. */
export function activeWorkspaceId(
  module: ModuleNavigation,
  pathname: string,
  search = "",
): string | null {
  const match = matchRoute(module, pathname, search);
  return match ? owningWorkspace(module, match).id : null;
}

export function sidebarItems(
  module: ModuleNavigation,
  viewer: NavViewer,
): Array<{ id: string; label: string; icon?: SecondaryNavSectionIcon; collapsible?: boolean; flat?: boolean; items: SecondaryNavItem[] }> {
  return module.sections
    .map((section) => ({
      id: section.id,
      label: section.label,
      icon: section.icon,
      collapsible: section.collapsible,
      flat: section.flat,
      items: section.items.filter(
        (item) =>
          isSidebarItem(item) &&
          (item.status !== "AVAILABLE" || isItemPermitted(item, viewer)),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export function groupFor(
  module: ModuleNavigation,
  item: SecondaryNavItem,
): WorkspaceGroup | undefined {
  return item.group
    ? module.groups?.find((group) => group.id === item.group)
    : undefined;
}

/** Destinations inside a workspace the viewer may open, in registry order. */
export function workspaceChildren(
  module: ModuleNavigation,
  workspaceId: string,
  viewer: NavViewer,
): SecondaryNavItem[] {
  return allItems(module).filter(
    (item) =>
      item.parent === workspaceId &&
      item.status === "AVAILABLE" &&
      isItemPermitted(item, viewer),
  );
}

export type Crumb = { label: string; href?: string };

/**
 * Module > Workspace > (Group) > Page. A module's own home collapses to the
 * module label; a workspace's own page stops at the workspace.
 */
export function breadcrumbTrail(
  module: ModuleNavigation,
  pathname: string,
  search = "",
): Crumb[] {
  const match = matchRoute(module, pathname, search);
  const root = allItems(module)[0];
  const moduleCrumb: Crumb = { label: module.label, href: root?.route };
  if (!match) return [moduleCrumb];
  const workspace = owningWorkspace(module, match);
  const trail: Crumb[] = [moduleCrumb];
  // A collapsible section (e.g. Inventory › Stock Operations) is part of the path to its workspaces.
  const section = module.sections.find((entry) => entry.items.some((item) => item.id === workspace.id));
  if (section?.collapsible && workspace.id !== root?.id) trail.push({ label: section.label });
  if (workspace.id !== root?.id)
    trail.push({ label: workspace.label, href: workspace.route });
  if (match.id !== workspace.id) {
    const group = groupFor(module, match);
    if (group)
      trail.push({
        label: group.label,
        href: `${workspace.route}#${group.id}`,
      });
    trail.push({ label: match.label, href: match.route });
  }
  return trail;
}

// Pure route-ownership rules over the canonical registry
// (module-navigation-registry.ts). The desktop secondary sidebar, the mobile
// drawer, breadcrumbs, global search and workspace hubs all resolve through
// these functions, so "which workspace owns this route" is decided once.
import type {
  ModuleNavigation,
  SecondaryNavItem,
  WorkspaceGroup,
} from "./navigation-types";

export type NavViewer = {
  permissions: readonly string[];
  /** organization_owner sees every destination, as it does server-side. */
  isOwner?: boolean;
};

export function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function allItems(module: ModuleNavigation): SecondaryNavItem[] {
  return module.sections.flatMap((section) => section.items);
}

/** A permanent sidebar workspace (not a view/feature/configuration inside one). */
export function isSidebarItem(item: SecondaryNavItem): boolean {
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
): SecondaryNavItem | undefined {
  let best: SecondaryNavItem | undefined;
  for (const item of allItems(module)) {
    if (item.status !== "AVAILABLE") continue;
    if (!matchesRoute(pathname, item.route)) continue;
    if (!best || item.route.length > best.route.length) best = item;
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
): string | null {
  const match = matchRoute(module, pathname);
  return match ? owningWorkspace(module, match).id : null;
}

export function sidebarItems(
  module: ModuleNavigation,
  viewer: NavViewer,
): Array<{ id: string; label: string; items: SecondaryNavItem[] }> {
  return module.sections
    .map((section) => ({
      id: section.id,
      label: section.label,
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
): Crumb[] {
  const match = matchRoute(module, pathname);
  const root = allItems(module)[0];
  const moduleCrumb: Crumb = { label: module.label, href: root?.route };
  if (!match) return [moduleCrumb];
  const workspace = owningWorkspace(module, match);
  const trail: Crumb[] = [moduleCrumb];
  if (workspace.id !== root?.id)
    trail.push({ label: workspace.label, href: workspace.route });
  if (match.id !== workspace.id) {
    const group = groupFor(module, match);
    if (group)
      trail.push({
        label: group.label,
        href: `${workspace.route}?section=${group.id}`,
      });
    trail.push({ label: match.label, href: match.route });
  }
  return trail;
}

"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import {
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
  UTILITY_NAV,
} from "@/shell/navigation/moduleNavigationRegistry";

const GLOBAL_ENTRIES = [
  ...GLOBAL_NAV_TOP,
  ...GLOBAL_NAV_BOTTOM,
  ...UTILITY_NAV,
];

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

// Picks the LONGEST matching route, not just the first one encountered —
// the module's own "Home" item is always registered with the module's
// bare root route (e.g. "/crm"), which prefix-matches every one of that
// module's sub-pages too. Taking the first match in array order (as this
// used to) meant "Home" won for every single CRM sub-page before its own,
// more specific item (e.g. "/crm/leads") was ever checked, collapsing
// every breadcrumb in the module down to just the module name.
function bestRouteMatch<T extends { route: string }>(
  items: readonly T[],
  pathname: string,
): T | undefined {
  return items
    .filter((item) => matchesRoute(pathname, item.route))
    .sort((a, b) => b.route.length - a.route.length)[0];
}

function crumbsForPathname(pathname: string): string[] {
  const activeModule = MODULE_NAVIGATION.find((entry) =>
    entry.sections.some((section) =>
      section.items.some((item) => matchesRoute(pathname, item.route)),
    ),
  );
  if (activeModule) {
    const item = bestRouteMatch(
      activeModule.sections.flatMap((section) => section.items),
      pathname,
    );
    // Module → Workspace, no redundant repetition — the module's own
    // Overview item never repeats the module label twice.
    if (!item || item.id === "home") return [activeModule.label];
    return [activeModule.label, item.label];
  }
  const global = bestRouteMatch(
    GLOBAL_ENTRIES.map((entry) => ({ ...entry, route: entry.href })),
    pathname,
  );
  return global && global.href !== "/" ? [global.label] : [];
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = crumbsForPathname(pathname);
  if (!crumbs.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-sm text-text-secondary"
    >
      {crumbs.map((crumb, index) => (
        <span key={crumb} className="flex items-center gap-1">
          {index > 0 ? (
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 text-text-muted"
            />
          ) : null}
          <span
            className={
              index === crumbs.length - 1 ? "font-medium text-text" : undefined
            }
          >
            {crumb}
          </span>
        </span>
      ))}
    </nav>
  );
}

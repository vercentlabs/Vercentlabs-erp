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

function crumbsForPathname(pathname: string): string[] {
  const activeModule = MODULE_NAVIGATION.find((entry) =>
    entry.sections.some((section) =>
      section.items.some(
        (item) =>
          pathname === item.route || pathname.startsWith(`${item.route}/`),
      ),
    ),
  );
  if (activeModule) {
    const item = activeModule.sections
      .flatMap((section) => section.items)
      .find(
        (entry) =>
          pathname === entry.route || pathname.startsWith(`${entry.route}/`),
      );
    // Module → Workspace, no redundant repetition — the module's own
    // Overview item never repeats the module label twice.
    if (!item || item.id === "home") return [activeModule.label];
    return [activeModule.label, item.label];
  }
  const global = GLOBAL_ENTRIES.find(
    (entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`),
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

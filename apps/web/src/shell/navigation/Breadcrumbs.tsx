"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import {
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
  UTILITY_NAV,
} from "@/shell/navigation/moduleNavigationRegistry";
import {
  breadcrumbTrail,
  matchRoute,
  matchesRoute,
  type Crumb,
} from "@/shell/navigation/navigation-resolution";

const GLOBAL_ENTRIES = [
  ...GLOBAL_NAV_TOP,
  ...GLOBAL_NAV_BOTTOM,
  ...UTILITY_NAV,
];

// Module > Workspace > (Group) > Page, from the same route-ownership rules
// the secondary sidebar uses (navigation-resolution.ts): /crm/pipeline reads
// CRM > Opportunities > Pipeline and /crm/settings/leads/stages reads
// CRM > CRM Settings > Lead Management > Lead Stages & Statuses.
function crumbsForPathname(pathname: string, search = ""): Crumb[] {
  const activeModule = MODULE_NAVIGATION.find((entry) =>
    matchRoute(entry, pathname),
  );
  if (activeModule) return breadcrumbTrail(activeModule, pathname, search);
  const global = GLOBAL_ENTRIES.filter((entry) =>
    matchesRoute(pathname, entry.href),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  return global && global.href !== "/" ? [{ label: global.label }] : [];
}

// The query (a tab or section of one page) is read inside Suspense, so pages rendered without it still show their trail.
export function Breadcrumbs() {
  const pathname = usePathname();
  return (
    <Suspense fallback={<Trail crumbs={crumbsForPathname(pathname)} />}>
      <BreadcrumbsWithQuery pathname={pathname} />
    </Suspense>
  );
}

function BreadcrumbsWithQuery({ pathname }: { pathname: string }) {
  const search = useSearchParams()?.toString() ?? "";
  return <Trail crumbs={crumbsForPathname(pathname, search)} />;
}

function Trail({ crumbs }: { crumbs: Crumb[] }) {
  if (!crumbs.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm text-text-secondary"
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span
            key={`${crumb.label}-${index}`}
            className="flex min-w-0 items-center gap-1"
          >
            {index > 0 ? (
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-text-muted"
              />
            ) : null}
            {last || !crumb.href ? (
              <span
                aria-current={last ? "page" : undefined}
                className={last ? "truncate font-medium text-text" : "truncate"}
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate hover:text-text hover:underline"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

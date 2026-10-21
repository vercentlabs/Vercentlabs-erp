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
import { useT } from "@/shared/i18n/I18nText";

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
// `fallback` names a page with no trail (Home) where a title is still wanted (the mobile top bar).
export function Breadcrumbs({ fallback }: { fallback?: string } = {}) {
  const pathname = usePathname();
  return (
    <Suspense fallback={<Trail crumbs={crumbsForPathname(pathname)} fallback={fallback} />}>
      <BreadcrumbsWithQuery pathname={pathname} fallback={fallback} />
    </Suspense>
  );
}

function BreadcrumbsWithQuery({ pathname, fallback }: { pathname: string; fallback?: string }) {
  const search = useSearchParams()?.toString() ?? "";
  return <Trail crumbs={crumbsForPathname(pathname, search)} fallback={fallback} />;
}

// A phone has no room for the whole trail: it shows the last two levels, the
// section and the page (the section opens its page when it has one).
function Trail({ crumbs: englishCrumbs, fallback }: { crumbs: Crumb[]; fallback?: string }) {
  const t = useT();
  const crumbs = englishCrumbs.map((crumb) => ({ ...crumb, label: t(crumb.label) }));
  if (!crumbs.length) return fallback ? <span aria-current="page" className="truncate text-sm font-semibold text-text">{fallback}</span> : null;
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;

  return (
    <nav
      aria-label={t("Breadcrumb")}
      className="flex min-w-0 items-center gap-1 text-sm text-text-secondary"
    >
      <span className="flex min-w-0 items-center gap-1 sm:hidden">
        {parent ? (
          <>
            {parent.href ? (
              <Link
                href={parent.href}
                className="min-w-0 shrink-[2] truncate hover:text-text hover:underline"
              >
                {parent.label}
              </Link>
            ) : (
              <span className="min-w-0 shrink-[2] truncate">
                {parent.label}
              </span>
            )}
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-text-muted"
            />
          </>
        ) : null}
        <span
          aria-current="page"
          className="min-w-0 truncate font-medium text-text"
        >
          {current.label}
        </span>
      </span>
      <span className="hidden min-w-0 items-center gap-1 sm:flex">
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
                  className={
                    last ? "truncate font-medium text-text" : "truncate"
                  }
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
      </span>
    </nav>
  );
}

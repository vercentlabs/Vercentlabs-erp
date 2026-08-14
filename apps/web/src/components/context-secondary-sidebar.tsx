"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import NavigationLink from "@/components/navigation-link";
import {
  filterGroupedNavigation,
  groupModuleNavigation,
  type GroupedNavigationItems,
} from "@/lib/navigation/module-navigation-ia";
import { matchesPath } from "@/lib/navigation/match-path";
import { moduleIdForPath } from "@/lib/navigation/route-map";
import type { ResolvedNavigationWithSettings } from "@/lib/navigation/resolve-navigation";
import type { NavigationItem } from "@/lib/navigation/types";

type SecondaryContext = {
  key: string;
  title: string;
  subtitle: string;
  icon: AppIconName;
  groups: GroupedNavigationItems[];
};

function anyMatch(pathname: string, items: NavigationItem[]): boolean {
  return items.some((item) => matchesPath(pathname, item));
}

function simpleGroup(
  label: string,
  items: NavigationItem[],
): GroupedNavigationItems[] {
  return items.length ? [{ label, items }] : [];
}

function resolveContext(
  pathname: string,
  navigation: ResolvedNavigationWithSettings,
): SecondaryContext | null {
  const moduleId = moduleIdForPath(pathname);
  if (moduleId) {
    const moduleNavigation = navigation.modules.find(
      (group) => group.moduleId === moduleId,
    );
    if (!moduleNavigation) return null;
    return {
      key: `module:${moduleNavigation.moduleId}`,
      title: moduleNavigation.label,
      subtitle: "Module workspace",
      icon: moduleNavigation.icon,
      groups: groupModuleNavigation(moduleNavigation),
    };
  }

  if (anyMatch(pathname, navigation.myWork)) {
    const workNow = navigation.myWork.filter((item) =>
      ["/my-work", "/tasks", "/follow-ups", "/exceptions", "/approvals"].includes(
        item.href,
      ),
    );
    const history = navigation.myWork.filter(
      (item) => !workNow.some((current) => current.href === item.href),
    );
    return {
      key: "my-work",
      title: "My work",
      subtitle: "Cross-module work queue",
      icon: "approvals",
      groups: [
        ...simpleGroup("Work queue", workNow),
        ...simpleGroup("History & alerts", history),
      ],
    };
  }

  if (anyMatch(pathname, navigation.governance)) {
    return {
      key: "governance",
      title: "Governance",
      subtitle: "Controls and assurance",
      icon: "security",
      groups: simpleGroup("Governance", navigation.governance),
    };
  }

  const administrationItems = [
    ...navigation.workspaceSettings.items,
    ...navigation.administration,
  ];
  if (anyMatch(pathname, administrationItems)) {
    return {
      key: "administration",
      title: "Administration",
      subtitle: "Workspace configuration",
      icon: "settings",
      groups: [
        ...simpleGroup("Workspace settings", navigation.workspaceSettings.items),
        ...simpleGroup("Platform", navigation.administration),
      ],
    };
  }

  return null;
}

export default function ContextSecondarySidebar({
  navigation,
  unreadNotifications,
}: {
  navigation: ResolvedNavigationWithSettings;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const context = useMemo(
    () => resolveContext(pathname, navigation),
    [pathname, navigation],
  );

  const [lastContextKey, setLastContextKey] = useState(context?.key ?? null);
  if ((context?.key ?? null) !== lastContextKey) {
    setLastContextKey(context?.key ?? null);
    if (query) setQuery("");
  }

  const visibleGroups = useMemo(
    () => filterGroupedNavigation(context?.groups ?? [], query),
    [context, query],
  );

  if (!context) return null;

  const itemCount = context.groups.reduce(
    (total, group) => total + group.items.length,
    0,
  );

  return (
    <aside
      className="context-secondary-sidebar"
      aria-label={`${context.title} navigation`}
    >
      <div className="context-secondary-sidebar__header">
        <div className="context-secondary-sidebar__identity">
          <span aria-hidden="true">
            <AppIcon name={context.icon} size={19} />
          </span>
          <div>
            <small>{context.subtitle}</small>
            <strong>{context.title}</strong>
          </div>
        </div>

        <label className="context-secondary-sidebar__search">
          <span className="sr-only">Search {context.title} navigation</span>
          <AppIcon name="search" size={16} />
          <input
            value={query}
            type="search"
            placeholder={`Search ${context.title}…`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear navigation search"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          ) : null}
        </label>

        <p className="context-secondary-sidebar__count">
          {itemCount} destination{itemCount === 1 ? "" : "s"}
        </p>
      </div>

      <nav
        className="context-secondary-sidebar__scroll"
        aria-label={`${context.title} destinations`}
      >
        {visibleGroups.map((group) => (
          <section
            className="context-secondary-sidebar__group"
            key={group.label}
            aria-label={group.label}
          >
            {group.label === "Overview" ? null : (
              <p className="context-secondary-sidebar__group-label">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <NavigationLink
                key={item.href}
                activePrefixes={item.activePrefixes}
                badge={
                  item.href === "/notifications"
                    ? unreadNotifications
                    : item.badge
                }
                exact={item.exact}
                href={item.href}
                icon={item.icon}
                label={item.label}
                nested
              />
            ))}
          </section>
        ))}

        {visibleGroups.length === 0 ? (
          <div className="context-secondary-sidebar__empty" role="status">
            <AppIcon name="search" size={20} />
            <strong>No navigation matches</strong>
            <span>Try a workspace name, feature area, or synonym.</span>
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

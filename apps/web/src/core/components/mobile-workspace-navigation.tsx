"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/shared/components/app-icon";
import NavigationLink from "@/core/components/navigation-link";
import {
  filterGroupedNavigation,
  groupModuleNavigation,
  type GroupedNavigationItems,
} from "@/core/navigation/module-navigation-ia";
import type { ResolvedNavigationWithSettings } from "@/core/navigation/resolve-navigation";
import type {
  ModuleId,
  NavigationItem,
} from "@/core/navigation/types";

type MobileView =
  | "root"
  | "my-work"
  | "governance"
  | "administration"
  | `module:${ModuleId}`;

type MobileContext = {
  title: string;
  subtitle: string;
  icon: AppIconName;
  groups: GroupedNavigationItems[];
};

function simpleGroup(
  label: string,
  items: NavigationItem[],
): GroupedNavigationItems[] {
  return items.length ? [{ label, items }] : [];
}

function ContextButton({
  label,
  icon,
  description,
  onClick,
}: {
  label: string;
  icon: AppIconName;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mobile-navigation-context-button"
      onClick={onClick}
    >
      <span className="mobile-navigation-context-button__icon" aria-hidden="true">
        <AppIcon name={icon} size={20} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <AppIcon name="arrow-right" size={16} />
    </button>
  );
}

export default function MobileWorkspaceNavigation({
  navigation,
  unreadNotifications,
}: {
  navigation: ResolvedNavigationWithSettings;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const [view, setView] = useState<MobileView>("root");
  const [query, setQuery] = useState("");
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setView("root");
    if (query) setQuery("");
  }

  const context = useMemo<MobileContext | null>(() => {
    if (view.startsWith("module:")) {
      const moduleId = view.slice("module:".length) as ModuleId;
      const moduleNavigation = navigation.modules.find(
        (item) => item.moduleId === moduleId,
      );
      if (!moduleNavigation) return null;
      return {
        title: moduleNavigation.label,
        subtitle: "Module workspace",
        icon: moduleNavigation.icon,
        groups: groupModuleNavigation(moduleNavigation),
      };
    }

    if (view === "my-work") {
      return {
        title: "Work",
        subtitle: "Cross-module work queue",
        icon: "approvals",
        groups: simpleGroup("Work", navigation.myWork),
      };
    }

    if (view === "governance") {
      return {
        title: "Governance",
        subtitle: "Controls and assurance",
        icon: "security",
        groups: simpleGroup("Governance", navigation.governance),
      };
    }

    if (view === "administration") {
      return {
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
  }, [navigation, view]);

  const visibleGroups = useMemo(
    () => filterGroupedNavigation(context?.groups ?? [], query),
    [context, query],
  );

  if (view === "root") {
    const home = navigation.workspace.find((item) => item.href === "/dashboard");
    const masterData = navigation.workspace.find(
      (item) => item.href === "/master-data",
    );

    return (
      <div className="mobile-workspace-navigation">
        <p className="mobile-navigation-label">Workspace</p>
        {home ? (
          <NavigationLink
            exact={home.exact}
            href={home.href}
            icon={home.icon}
            label={home.label}
            mobile
          />
        ) : null}
        {masterData ? (
          <NavigationLink
            href={masterData.href}
            icon={masterData.icon}
            label={masterData.label}
            mobile
          />
        ) : null}

        {navigation.myWork.length ? (
          <ContextButton
            label="Work"
            icon="approvals"
            description="Tasks, approvals, exceptions and recent work"
            onClick={() => setView("my-work")}
          />
        ) : null}

        {navigation.modules.length ? (
          <>
            <p className="mobile-navigation-label">Modules</p>
            <div className="mobile-navigation-context-list">
              {navigation.modules.map((module) => (
                <ContextButton
                  key={module.moduleId}
                  label={module.label}
                  icon={module.icon}
                  description={`${module.items.length} workspace destination${module.items.length === 1 ? "" : "s"}`}
                  onClick={() => setView(`module:${module.moduleId}`)}
                />
              ))}
            </div>
          </>
        ) : null}

        {(navigation.governance.length ||
          navigation.administration.length ||
          navigation.workspaceSettings.items.length) ? (
          <>
            <p className="mobile-navigation-label">System</p>
            {navigation.governance.length ? (
              <ContextButton
                label="Governance"
                icon="security"
                description="Billing, audit and compliance"
                onClick={() => setView("governance")}
              />
            ) : null}
            {navigation.administration.length ||
            navigation.workspaceSettings.items.length ? (
              <ContextButton
                label="Administration"
                icon="settings"
                description="Workspace and platform configuration"
                onClick={() => setView("administration")}
              />
            ) : null}
          </>
        ) : null}

        <NavigationLink
          href="/profile"
          icon="profile"
          label="Profile"
          mobile
        />
      </div>
    );
  }

  if (!context) {
    return (
      <div className="mobile-workspace-navigation">
        <button
          type="button"
          className="mobile-navigation-back"
          onClick={() => setView("root")}
        >
          ← Back to navigation
        </button>
      </div>
    );
  }

  return (
    <div className="mobile-workspace-navigation">
      <button
        type="button"
        className="mobile-navigation-back"
        onClick={() => {
          setView("root");
          setQuery("");
        }}
      >
        <span aria-hidden="true">←</span>
        All navigation
      </button>

      <div className="mobile-navigation-context-heading">
        <span aria-hidden="true">
          <AppIcon name={context.icon} size={21} />
        </span>
        <div>
          <small>{context.subtitle}</small>
          <strong>{context.title}</strong>
        </div>
      </div>

      <label className="mobile-navigation-search">
        <span className="sr-only">Search {context.title} navigation</span>
        <AppIcon name="search" size={16} />
        <input
          type="search"
          value={query}
          placeholder={`Search ${context.title}…`}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="mobile-navigation-groups">
        {visibleGroups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            {group.label === "Overview" || group.label === "Home" ? null : (
              <p className="mobile-navigation-label">{group.label}</p>
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
                mobile
                nested
              />
            ))}
          </section>
        ))}

        {visibleGroups.length === 0 ? (
          <p className="mobile-navigation-empty" role="status">
            No matching destination. Try another term.
          </p>
        ) : null}
      </div>
    </div>
  );
}

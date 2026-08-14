"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { matchesPath } from "@/lib/navigation/match-path";
import { moduleIdForPath } from "@/lib/navigation/route-map";
import type { ResolvedNavigationWithSettings } from "@/lib/navigation/resolve-navigation";
import type {
  ModuleNavigationGroup,
  NavigationItem,
} from "@/lib/navigation/types";

function matchesAny(pathname: string, items: NavigationItem[]): boolean {
  return items.some((item) => matchesPath(pathname, item));
}

function rootForModule(module: ModuleNavigationGroup): NavigationItem | null {
  return module.items.find((item) => item.exact) ?? module.items[0] ?? null;
}

function RailLink({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: AppIconName;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`v2-rail-link${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
    >
      <span className="v2-rail-link__icon" aria-hidden="true">
        <AppIcon name={icon} size={20} />
      </span>
      <span className="v2-rail-link__label">{label}</span>
      {badge ? (
        <span className="v2-rail-link__badge" aria-label={`${badge} unread`}>
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

export default function PrimaryNavigationRail({
  navigation,
  unreadNotifications,
  fullName,
  role,
}: {
  navigation: ResolvedNavigationWithSettings;
  unreadNotifications: number;
  fullName: string;
  role: string;
}) {
  const pathname = usePathname();
  const activeModuleId = moduleIdForPath(pathname);

  const home =
    navigation.workspace.find((item) => item.href === "/dashboard") ??
    navigation.workspace[0];
  const masterData = navigation.workspace.find(
    (item) => item.href === "/master-data",
  );
  const myWork =
    navigation.myWork.find((item) => item.href === "/my-work") ??
    navigation.myWork[0];
  const governance = navigation.governance[0];
  const administration =
    navigation.workspaceSettings.items.find((item) => item.href === "/settings") ??
    navigation.administration[0];

  const myWorkActive = matchesAny(pathname, navigation.myWork);
  const governanceActive = matchesAny(pathname, navigation.governance);
  const administrationItems = [
    ...navigation.workspaceSettings.items,
    ...navigation.administration,
  ];
  const administrationActive = matchesAny(pathname, administrationItems);

  return (
    <aside
      className="primary-navigation-rail"
      aria-label="Primary ERP navigation"
    >
      <div className="primary-navigation-rail__surface">
        <Link
          href="/dashboard"
          className="v2-rail-brand"
          aria-label="Vercentlabs ERP home"
        >
          <span className="v2-rail-brand__mark" aria-hidden="true">
            V
          </span>
          <span className="v2-rail-brand__copy">
            <strong>Vercentlabs</strong>
            <small>ERP workspace</small>
          </span>
        </Link>

        <nav className="v2-rail-scroll" aria-label="Workspace and modules">
          <section className="v2-rail-group" aria-label="Workspace">
            <p className="v2-rail-group__label">Workspace</p>
            {home ? (
              <RailLink
                href={home.href}
                label={home.label}
                icon={home.icon}
                active={matchesPath(pathname, home)}
              />
            ) : null}
            {myWork ? (
              <RailLink
                href={myWork.href}
                label="My work"
                icon="approvals"
                active={myWorkActive}
                badge={unreadNotifications}
              />
            ) : null}
            {masterData ? (
              <RailLink
                href={masterData.href}
                label={masterData.label}
                icon={masterData.icon}
                active={matchesPath(pathname, masterData)}
              />
            ) : null}
          </section>

          {navigation.modules.length ? (
            <section className="v2-rail-group" aria-label="ERP modules">
              <p className="v2-rail-group__label">Modules</p>
              {navigation.modules.map((module) => {
                const root = rootForModule(module);
                if (!root) return null;
                return (
                  <RailLink
                    key={module.moduleId}
                    href={root.href}
                    label={module.label}
                    icon={module.icon}
                    active={activeModuleId === module.moduleId}
                  />
                );
              })}
            </section>
          ) : null}

          {(governance || administration) ? (
            <section className="v2-rail-group" aria-label="System">
              <p className="v2-rail-group__label">System</p>
              {governance ? (
                <RailLink
                  href={governance.href}
                  label="Governance"
                  icon="security"
                  active={governanceActive}
                />
              ) : null}
              {administration ? (
                <RailLink
                  href={administration.href}
                  label="Administration"
                  icon="settings"
                  active={administrationActive}
                />
              ) : null}
            </section>
          ) : null}
        </nav>

        <Link
          href="/profile"
          className={`v2-rail-profile${pathname === "/profile" ? " active" : ""}`}
          aria-label={`Profile: ${fullName}`}
          title={`${fullName} — ${role}`}
        >
          <span className="v2-rail-link__icon" aria-hidden="true">
            <AppIcon name="profile" size={20} />
          </span>
          <span className="v2-rail-profile__copy">
            <strong>{fullName}</strong>
            <small>{role}</small>
          </span>
        </Link>
      </div>
    </aside>
  );
}

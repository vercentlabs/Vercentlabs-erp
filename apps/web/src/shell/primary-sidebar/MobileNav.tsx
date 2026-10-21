"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, Lock, Search, Settings } from "lucide-react";
import { Drawer, IconButton, IconLinkButton } from "@vercentlabs/design-system";
import type { ModuleAccess } from "@vercentlabs/api";

import { useSearchDialog } from "@/features/platform/search/SearchDialog";

import {
  MODULE_NAV_ENTRIES,
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
} from "@/shell/navigation/moduleNavigationRegistry";
import { Breadcrumbs } from "@/shell/navigation/Breadcrumbs";
import { ProfileMenu } from "@/shell/primary-sidebar/ProfileMenu";
import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import {
  activeWorkspaceId,
  sidebarItems,
} from "@/shell/navigation/navigation-resolution";
import { useT } from "@/shared/i18n/I18nText";

const MODULE_ACCESS_REASON_LABEL: Record<string, string> = {
  not_released: "Not yet available",
  disabled: "Not enabled for your organisation",
  not_entitled: "Not included in your plan",
  not_permitted: "You don't have permission for this module",
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DrawerRow({
  href,
  label: englishLabel,
  icon,
  disabled,
  disabledReason,
  active,
  onNavigate,
  badgeCount,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  active: boolean;
  onNavigate: () => void;
  badgeCount?: number;
}) {
  const t = useT();
  const label = t(englishLabel);
  if (disabled) {
    return (
      <span className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm text-text-muted opacity-60">
        {icon}
        <span className="flex-1">{label}</span>
        <Lock aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{disabledReason && t(disabledReason)}</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-brand-soft text-brand font-medium"
          : "text-text hover:bg-surface-muted",
      ].join(" ")}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badgeCount ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-text-inverse">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </Link>
  );
}

// Phone/tablet nav surface (<1024px) — the primary icon rail is hidden at
// this breakpoint (PrimarySidebar has `hidden lg:flex`) in favor of this
// top bar + full-label drawer — never both sidebars squeezed into 390px.
const BADGE_SOURCE_VALUE: Record<
  string,
  (counts: {
    pendingApprovalCount: number;
    unreadNotificationCount: number;
  }) => number
> = {
  pendingApprovals: (counts) => counts.pendingApprovalCount,
  unreadNotifications: (counts) => counts.unreadNotificationCount,
};

export function MobileNav({
  fullName,
  email,
  organizationName,
  accessibleModules,
  permissions,
  pendingApprovalCount,
  unreadNotificationCount,
}: {
  fullName: string;
  email: string;
  organizationName: string | null;
  accessibleModules: ModuleAccess[];
  permissions: string[];
  pendingApprovalCount: number;
  unreadNotificationCount: number;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const pathname = usePathname();
  const accessByModuleKey = new Map(
    accessibleModules.map((access) => [access.moduleId, access]),
  );
  const counts = { pendingApprovalCount, unreadNotificationCount };

  const { openSearch } = useSearchDialog();

  return (
    <div className="flex lg:hidden">
      <header className="flex h-14 w-full shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <IconButton
          aria-label="Open navigation"
          variant="ghost"
          onPress={() => setOpen(true)}
        >
          <MenuIcon aria-hidden="true" className="size-5" />
        </IconButton>
        {/* Where the person is (CRM, or "Leads › Ayush" further in), not the company name: below desktop this bar is the only header. */}
        <div className="min-w-0 flex-1">
          <Breadcrumbs fallback="Home" />
        </div>
        {/* Search, Settings and the account menu (profile, help, sign out) sit here, not in the drawer. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton aria-label="Search" variant="ghost" onPress={openSearch}>
            <Search aria-hidden="true" className="size-5" />
          </IconButton>
          <IconLinkButton
            href="/settings"
            aria-label="Settings"
            variant="ghost"
            className={isActive(pathname, "/settings") ? "text-brand" : undefined}
          >
            <Settings aria-hidden="true" className="size-5" />
          </IconLinkButton>
          <ProfileMenu fullName={fullName} email={email} showHelp />
        </div>
      </header>

      <Drawer
        isOpen={open}
        onOpenChange={setOpen}
        title={organizationName || "Vercentlabs ERP"}
        side="left"
        size="sm"
      >
        {({ close }) => (
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {GLOBAL_NAV_TOP.map((entry) => (
              <DrawerRow
                key={entry.key}
                href={entry.href}
                label={entry.label}
                icon={<entry.icon aria-hidden="true" className="size-4" />}
                active={isActive(pathname, entry.href)}
                onNavigate={close}
              />
            ))}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {MODULE_NAV_ENTRIES.filter((entry) => accessByModuleKey.get(entry.moduleKey)?.accessible).map((entry) => {
              const access = accessByModuleKey.get(entry.moduleKey);
              const accessible = access?.accessible ?? false;
              const inModule = accessible && isActive(pathname, entry.href);
              // The module you are in lists its permanent workspaces (the
              // same set the desktop secondary sidebar shows, from the same
              // registry and rules); views and configuration pages stay
              // inside their workspace — no nested third navigation.
              const moduleNavigation = inModule
                ? getModuleNavigation(entry.moduleKey)
                : null;
              const activeId = moduleNavigation
                ? activeWorkspaceId(moduleNavigation, pathname)
                : null;
              const workspaces = moduleNavigation
                ? sidebarItems(moduleNavigation, { permissions })
                    .flatMap((section) => section.items)
                    .filter((item) => item.status === "AVAILABLE")
                : [];
              return (
                <div key={entry.moduleKey} className="flex flex-col gap-1">
                  <DrawerRow
                    href={entry.href}
                    label={entry.label}
                    icon={<entry.icon aria-hidden="true" className="size-4" />}
                    disabled={!accessible}
                    disabledReason={
                      access?.reason
                        ? MODULE_ACCESS_REASON_LABEL[access.reason]
                        : undefined
                    }
                    active={inModule && workspaces.length === 0}
                    onNavigate={close}
                  />
                  {workspaces.length > 0 && (
                    <ul
                      aria-label={t("{name} workspaces", { name: t(entry.label) })}
                      className="ml-6 flex flex-col gap-0.5 border-l border-border pl-2"
                    >
                      {workspaces.map((item) => (
                        <li key={item.id}>
                          <Link
                            href={item.route}
                            onClick={close}
                            aria-current={
                              item.id === activeId ? "page" : undefined
                            }
                            className={[
                              "flex rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors",
                              item.id === activeId
                                ? "bg-brand-soft font-medium text-brand"
                                : "text-text hover:bg-surface-muted",
                            ].join(" ")}
                          >
                            {t(item.label)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {GLOBAL_NAV_BOTTOM.filter(
              (entry) =>
                entry.placement !== "hidden" &&
                (!entry.requiredPermission ||
                  permissions.includes(entry.requiredPermission)),
            ).map((entry) => (
              <DrawerRow
                key={entry.key}
                href={entry.href}
                label={entry.label}
                icon={<entry.icon aria-hidden="true" className="size-4" />}
                active={isActive(pathname, entry.href)}
                onNavigate={close}
                badgeCount={
                  entry.badgeSource
                    ? BADGE_SOURCE_VALUE[entry.badgeSource](counts)
                    : undefined
                }
              />
            ))}

          </nav>
        )}
      </Drawer>
    </div>
  );
}

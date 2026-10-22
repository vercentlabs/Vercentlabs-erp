"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, Search, Settings } from "lucide-react";
import { Drawer, IconButton, IconLinkButton } from "@vercentlabs/design-system";
import type { ModuleAccess } from "@vercentlabs/api";

import { useSearchDialog } from "@/features/platform/search/SearchDialog";
import { NotificationsPanel } from "@/features/platform/notifications/NotificationsPanel";

import {
  MODULE_NAV_ENTRIES,
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
} from "@/shell/navigation/moduleNavigationRegistry";
import { Breadcrumbs } from "@/shell/navigation/Breadcrumbs";
import { ProfileMenu } from "@/shell/primary-sidebar/ProfileMenu";
import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import { ModuleMenu } from "@/shell/module-sidebar/SecondarySidebar";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The drawer's app rail: an icon over its name (no hover on a phone, so the name is always shown), in the short form that fits.
const SHORT_NAMES: Record<string, string> = {
  procurement: "Purchase", "hr-payroll": "HR", manufacturing: "Production", jobs: "Jobs", "point-of-sale": "POS",
};
const shortName = (key: string, label: string) => SHORT_NAMES[key] ?? label;

const railClass = (active: boolean) =>
  [
    "relative flex flex-col items-center gap-1 rounded-[var(--radius-control)] px-0.5 py-2 text-center text-[11px] leading-tight transition-colors",
    active ? "bg-brand-soft font-medium text-brand" : "text-text-secondary hover:bg-surface-muted hover:text-text",
  ].join(" ");

function RailLink({ href, label, icon, active, onNavigate, badgeCount }: {
  href: string; label: string; icon: React.ReactNode; active: boolean; onNavigate: () => void; badgeCount?: number;
}) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={railClass(active)}>
      {icon}
      <span className="line-clamp-2 w-full break-words">{label}</span>
      {badgeCount ? (
        <span className="absolute top-1 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-text-inverse">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </Link>
  );
}

function RailButton({ label, icon, selected, current, onPress }: { label: string; icon: React.ReactNode; selected: boolean; current: boolean; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} aria-pressed={selected} aria-current={current ? "page" : undefined} className={railClass(selected)}>
      {icon}
      <span className="line-clamp-2 w-full break-words">{label}</span>
    </button>
  );
}

// Phone/tablet nav surface (<1024px): the top bar, and a drawer with the same two sidebars as desktop — the app rail and the chosen
// app's menu (ModuleMenu, the desktop secondary sidebar's own body).
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
  const pathname = usePathname();
  const accessByModuleKey = new Map(
    accessibleModules.map((access) => [access.moduleId, access]),
  );
  const counts = { pendingApprovalCount, unreadNotificationCount };

  const { openSearch } = useSearchDialog();
  // The app whose menu the drawer's second column shows: the one tapped, else the one you are in.
  const [picked, setPicked] = useState<string | null>(null);
  const modules = MODULE_NAV_ENTRIES.filter((entry) => accessByModuleKey.get(entry.moduleKey)?.accessible);
  const currentModuleKey = modules.find((entry) => isActive(pathname, `/${entry.href.split("/")[1]}`))?.moduleKey ?? null;

  return (
    <div className="flex lg:hidden">
      {/* Edges kept even: the menu icon and the avatar sit the same distance in from each side; the title sits just after the menu. */}
      <header className="flex h-14 w-full shrink-0 items-center gap-1 border-b border-border bg-surface px-2.5">
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
        {/* Search, Settings, Notifications and the account menu (profile, help, sign out), in desktop's order — not in the drawer. */}
        <div className="flex shrink-0 items-center">
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
          <NotificationsPanel unreadCount={unreadNotificationCount} />
          <ProfileMenu fullName={fullName} email={email} showHelp />
        </div>
      </header>

      <Drawer
        isOpen={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setPicked(null); }}
        title={organizationName || "Vercentlabs ERP"}
        side="left"
        size="sm"
        className="gap-3 px-0 pt-4 pb-0 max-lg:pb-0"
        headerClassName="px-4"
      >
        {({ close }) => {
          const shownKey = picked ?? currentModuleKey ?? modules[0]?.moduleKey ?? null;
          const shown = shownKey ? getModuleNavigation(shownKey) : null;
          const shownEntry = modules.find((entry) => entry.moduleKey === shownKey);
          return (
            // Two columns, as on desktop: the apps on the left, the chosen app's own menu on the right. Tapping an app shows its menu
            // without leaving the page; a menu link opens its page and closes the drawer.
            <div className="flex h-full min-h-0 border-t border-border">
              <nav aria-label="Apps" className="flex w-20 shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-border px-1.5 py-2
                max-lg:pb-[calc(1rem+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {GLOBAL_NAV_TOP.map((entry) => (
                  <RailLink key={entry.key} href={entry.href} label={shortName(entry.key, entry.label)} icon={<entry.icon aria-hidden="true" className="size-5" />}
                    active={isActive(pathname, entry.href)} onNavigate={close} />
                ))}
                <div aria-hidden="true" className="mx-2 my-1 h-px bg-border" />
                {modules.map((entry) => (
                  <RailButton key={entry.moduleKey} label={shortName(entry.moduleKey, entry.label)} icon={<entry.icon aria-hidden="true" className="size-5" />}
                    selected={entry.moduleKey === shownKey} current={entry.moduleKey === currentModuleKey}
                    onPress={() => setPicked(entry.moduleKey)} />
                ))}
                <div aria-hidden="true" className="mx-2 my-1 h-px bg-border" />
                {GLOBAL_NAV_BOTTOM.filter(
                  // The top bar's own entries (the Notifications bell) are not repeated here.
                  (entry) => !entry.placement && (!entry.requiredPermission || permissions.includes(entry.requiredPermission)),
                ).map((entry) => (
                  <RailLink key={entry.key} href={entry.href} label={shortName(entry.key, entry.label)} icon={<entry.icon aria-hidden="true" className="size-5" />}
                    active={isActive(pathname, entry.href)} onNavigate={close}
                    badgeCount={entry.badgeSource ? BADGE_SOURCE_VALUE[entry.badgeSource](counts) : undefined} />
                ))}
              </nav>
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto py-3 [scrollbar-width:thin] max-lg:pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {shown && shownEntry ? (
                  <>
                    <h2 className="flex items-center gap-2 px-4 pb-3 text-base font-semibold text-text">
                      <shownEntry.icon aria-hidden="true" className="size-5 text-brand" />
                      {shownEntry.label}
                    </h2>
                    <ModuleMenu module={shown} onNavigate={close} />
                  </>
                ) : (
                  <p className="px-4 text-sm text-text-muted">Choose an app on the left.</p>
                )}
              </div>
            </div>
          );
        }}
      </Drawer>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearOfflineSecrets } from "@/shared/offline/clear-offline-secrets";
import { LogOut, Menu as MenuIcon, Lock, User } from "lucide-react";
import { Drawer, IconButton } from "@vercentlabs/design-system";
import type { ModuleAccess } from "@vercentlabs/api";

import {
  MODULE_NAV_ENTRIES,
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
  UTILITY_NAV,
} from "@/shell/navigation/moduleNavigationRegistry";

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

// Checkpoint audit (ERP completion gap register, Phase 6): ProfileMenu
// (the sign-out entry point) lives in PrimarySidebar, which is
// `hidden lg:flex` — below 1024px there was no sign-out control
// anywhere in the app at all. DrawerRow's Link-only shape can't express
// an action, so this is a small, separate row type for it.
function DrawerActionRow({
  label,
  icon,
  onPress,
  isLoading,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  isLoading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={isLoading}
      className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm text-text transition-colors hover:bg-surface-muted disabled:opacity-60"
    >
      {icon}
      <span className="flex-1">{isLoading ? "Signing out…" : label}</span>
    </button>
  );
}

function DrawerRow({
  href,
  label,
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
  if (disabled) {
    return (
      <span className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm text-text-muted opacity-60">
        {icon}
        <span className="flex-1">{label}</span>
        <Lock aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{disabledReason}</span>
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
// top bar + full-label drawer, per Phase 2's explicit "never just squeeze
// both sidebars into 390px" instruction.
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
  organizationName,
  accessibleModules,
  permissions,
  pendingApprovalCount,
  unreadNotificationCount,
}: {
  organizationName: string | null;
  accessibleModules: ModuleAccess[];
  permissions: string[];
  pendingApprovalCount: number;
  unreadNotificationCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const accessByModuleKey = new Map(
    accessibleModules.map((access) => [access.moduleId, access]),
  );
  const counts = { pendingApprovalCount, unreadNotificationCount };

  const queryClient = useQueryClient();

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      await clearOfflineSecrets();
      router.push("/login");
      router.refresh();
    }
  }

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
        <span className="truncate text-sm font-semibold text-text">
          {organizationName || "Vercentlabs ERP"}
        </span>
      </header>

      <Drawer
        isOpen={open}
        onOpenChange={setOpen}
        title="Navigation"
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

            {MODULE_NAV_ENTRIES.map((entry) => {
              const access = accessByModuleKey.get(entry.moduleKey);
              const accessible = access?.accessible ?? false;
              return (
                <DrawerRow
                  key={entry.moduleKey}
                  href={entry.href}
                  label={entry.label}
                  icon={<entry.icon aria-hidden="true" className="size-4" />}
                  disabled={!accessible}
                  disabledReason={
                    access?.reason
                      ? MODULE_ACCESS_REASON_LABEL[access.reason]
                      : undefined
                  }
                  active={isActive(pathname, entry.href)}
                  onNavigate={close}
                />
              );
            })}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {GLOBAL_NAV_BOTTOM.filter(
              (entry) =>
                !entry.requiredPermission ||
                permissions.includes(entry.requiredPermission),
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

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            {UTILITY_NAV.map((entry) => (
              <DrawerRow
                key={entry.key}
                href={entry.href}
                label={entry.label}
                icon={<entry.icon aria-hidden="true" className="size-4" />}
                disabled={entry.availability === "planned"}
                disabledReason={
                  entry.availability === "planned" ? "Coming soon" : undefined
                }
                active={isActive(pathname, entry.href)}
                onNavigate={close}
              />
            ))}

            <div aria-hidden="true" className="my-2 h-px bg-border" />

            <DrawerRow
              href="/settings/profile"
              label="Profile"
              icon={<User aria-hidden="true" className="size-4" />}
              active={isActive(pathname, "/settings/profile")}
              onNavigate={close}
            />
            <DrawerActionRow label="Sign out" icon={<LogOut aria-hidden="true" className="size-4" />} onPress={handleSignOut} isLoading={signingOut} />
          </nav>
        )}
      </Drawer>
    </div>
  );
}

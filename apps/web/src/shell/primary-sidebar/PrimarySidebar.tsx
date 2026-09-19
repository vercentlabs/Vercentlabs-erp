import Link from "next/link";

import type { ModuleAccess } from "@vercentlabs/api";

import {
  MODULE_NAV_ENTRIES,
  GLOBAL_NAV_TOP,
  GLOBAL_NAV_BOTTOM,
  UTILITY_NAV,
} from "@/shell/navigation/moduleNavigationRegistry";

import { PrimaryNavItem } from "./PrimaryNavItem";

const MODULE_ACCESS_REASON_LABEL: Record<string, string> = {
  not_released: "Not yet available",
  disabled: "Not enabled for your organisation",
  not_entitled: "Not included in your plan",
  not_permitted: "You don't have permission for this module",
};

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

export function PrimarySidebar({
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
  const accessByModuleKey = new Map(
    accessibleModules.map((access) => [access.moduleId, access]),
  );
  const counts = { pendingApprovalCount, unreadNotificationCount };

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-[64px] shrink-0 flex-col items-center bg-navigation py-3"
    >
      <Link
        href="/"
        aria-label={`${organizationName || "Vercentlabs"} home`}
        className="mb-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-sm font-bold text-navigation-text hover:bg-white/10"
      >
        V
      </Link>

      {/* Scroll-safe middle region — Home/Work, the 12 modules, and
          Approvals/Notifications/Jobs. Help stays pinned below regardless
          of how many icons this region holds. Search, Settings and Profile
          live in WorkspaceTopBar (registry `placement: "topbar"`). */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {GLOBAL_NAV_TOP.filter((entry) => entry.placement !== "topbar").map((entry) => (
          <PrimaryNavItem
            key={entry.key}
            href={entry.href}
            label={entry.label}
            icon={<entry.icon aria-hidden="true" className="size-5" />}
          />
        ))}

        <div
          aria-hidden="true"
          className="my-2 h-px w-8 shrink-0 bg-white/10"
        />

        {MODULE_NAV_ENTRIES.map((entry) => {
          const access = accessByModuleKey.get(entry.moduleKey);
          // Backend is the authority: a module never renders as available
          // just because the registry lists it. Entitlement/permission
          // resolution comes from services/api's ported
          // module-entitlements.js via resolveWorkspaceContext().
          const accessible = access?.accessible ?? false;
          return (
            <PrimaryNavItem
              key={entry.moduleKey}
              href={entry.href}
              label={entry.label}
              icon={<entry.icon aria-hidden="true" className="size-5" />}
              disabled={!accessible}
              disabledReason={
                access?.reason
                  ? MODULE_ACCESS_REASON_LABEL[access.reason]
                  : undefined
              }
            />
          );
        })}

        <div
          aria-hidden="true"
          className="my-2 h-px w-8 shrink-0 bg-white/10"
        />

        {GLOBAL_NAV_BOTTOM.filter(
          (entry) =>
            !entry.requiredPermission ||
            permissions.includes(entry.requiredPermission),
        ).map((entry) => (
          <PrimaryNavItem
            key={entry.key}
            href={entry.href}
            label={entry.label}
            icon={<entry.icon aria-hidden="true" className="size-5" />}
            badgeCount={
              entry.badgeSource
                ? BADGE_SOURCE_VALUE[entry.badgeSource](counts)
                : undefined
            }
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
        {UTILITY_NAV.filter((entry) => entry.placement !== "topbar").map((entry) => (
          <PrimaryNavItem
            key={entry.key}
            href={entry.href}
            label={entry.label}
            icon={<entry.icon aria-hidden="true" className="size-5" />}
            disabled={entry.availability === "planned"}
            disabledReason={
              entry.availability === "planned" ? "Coming soon" : undefined
            }
          />
        ))}
      </div>
    </nav>
  );
}

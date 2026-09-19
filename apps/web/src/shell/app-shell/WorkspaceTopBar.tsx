"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Breadcrumbs } from "@/shell/navigation/Breadcrumbs";
import {
  GLOBAL_NAV_TOP,
  UTILITY_NAV,
} from "@/shell/navigation/moduleNavigationRegistry";
import { ProfileMenu } from "@/shell/primary-sidebar/ProfileMenu";
import { ContextSwitcher } from "@/shell/workspace-context/ContextSwitcher";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// Search/Settings are the registry entries flagged `placement: "topbar"` —
// the primary sidebar filters those same entries out, so each renders in
// exactly one place on desktop.
const TOPBAR_ENTRIES = [...GLOBAL_NAV_TOP, ...UTILITY_NAV].filter(
  (entry) => entry.placement === "topbar",
);
const SEARCH_ENTRY = TOPBAR_ENTRIES.find((entry) => entry.key === "search");
const SETTINGS_ENTRY = TOPBAR_ENTRIES.find((entry) => entry.key === "settings");

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Icon link with a hover/focus tooltip below it. A plain portaled span, not
// react-aria's TooltipTrigger, for the same reason as PrimaryNavItem.tsx (it
// breaks next/link navigation). Right-aligned to the icon because this sits
// at the viewport's right edge — see ProfileMenu.tsx.
function TopBarIconLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; right: number } | null>(null);

  function showTooltip() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }
  function hideTooltip() {
    setTooltipPosition(null);
  }

  return (
    <span
      ref={triggerRef}
      className="relative flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <Link
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={[
          "flex size-9 items-center justify-center rounded-[var(--radius-control)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
          active
            ? "bg-brand-soft text-brand"
            : "text-text-secondary hover:bg-surface-muted hover:text-text",
        ].join(" ")}
      >
        {icon}
      </Link>
      {tooltipPosition && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              style={{ top: tooltipPosition.top, right: tooltipPosition.right }}
              className="pointer-events-none fixed z-50 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text shadow-panel"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

// Persistent strip above every workspace page (desktop and mobile) —
// breadcrumbs (Phase 19) on the left; on the right, search, the company/
// branch context switcher (Phase 4), Settings and the profile menu. One
// place for all of it rather than each page building its own header.
//
// Search/Settings/Profile are desktop-only here (`hidden lg:flex`): below
// 1024px MobileNav's drawer already lists Search, Settings, Profile and Sign
// out, and this strip has no room for them beside the context switcher.
export function WorkspaceTopBar() {
  const pathname = usePathname();
  const { fullName, email } = useWorkspaceContext();

  return (
    // Horizontal padding must match <main>'s (AppShell.tsx: px-6 md:px-8) so
    // the breadcrumb's left edge lines up with the page title directly
    // below it, instead of sitting a few pixels to its left.
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-6 md:px-8">
      <Breadcrumbs />
      {/* ml-auto, not just justify-between: Breadcrumbs renders nothing on
          Home, which would otherwise leave this cluster as the row's only
          child, stranded on the left. */}
      <div className="ml-auto flex items-center gap-2">
        {SEARCH_ENTRY ? (
          <Link
            href={SEARCH_ENTRY.href}
            aria-label={SEARCH_ENTRY.label}
            aria-current={isActive(pathname, SEARCH_ENTRY.href) ? "page" : undefined}
            className="hidden h-9 w-56 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-canvas px-3 text-sm text-text-muted outline-none transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 lg:flex"
          >
            <SEARCH_ENTRY.icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">Search…</span>
          </Link>
        ) : null}
        <ContextSwitcher />
        <div className="hidden items-center gap-1 lg:flex">
          {SETTINGS_ENTRY ? (
            <TopBarIconLink
              href={SETTINGS_ENTRY.href}
              label={SETTINGS_ENTRY.label}
              icon={<SETTINGS_ENTRY.icon aria-hidden="true" className="size-5" />}
              active={isActive(pathname, SETTINGS_ENTRY.href)}
            />
          ) : null}
          <ProfileMenu fullName={fullName} email={email} />
        </div>
      </div>
    </div>
  );
}

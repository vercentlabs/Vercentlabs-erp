"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// `icon` is a pre-rendered ReactNode, not a component reference — a
// Server Component (PrimarySidebar) cannot pass a function/component
// reference as a prop across the server/client boundary (React Server
// Components can only serialize data and already-resolved element trees).
// The caller renders `<Icon />` itself and hands this component the
// resulting element.
//
// Tooltip is a plain CSS hover/focus reveal, not React Aria's
// TooltipTrigger — verified in a real browser that wrapping a plain
// next/link `<Link>` in React Aria's TooltipTrigger breaks navigation
// (TooltipTrigger's PressResponder expects a usePress-compatible child;
// next/link isn't one, and the click silently stopped navigating).
export function PrimaryNavItem({
  href,
  label,
  icon,
  disabled = false,
  disabledReason,
  badgeCount,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  /** Only ever an actionable count (pending approvals, unread notifications) — never a decorative volume count. */
  badgeCount?: number;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  const tooltipText = disabled
    ? disabledReason || `${label} is unavailable`
    : label;

  const iconChrome = (
    <span
      className={[
        "relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] transition-colors",
        disabled
          ? "cursor-not-allowed text-navigation-muted opacity-50"
          : active
            ? "bg-white/15 text-navigation-text"
            : "text-navigation-muted hover:bg-white/10 hover:text-navigation-text",
      ].join(" ")}
    >
      {active && !disabled ? (
        <span
          aria-hidden="true"
          className="absolute left-[-8px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand"
        />
      ) : null}
      {icon}
      {disabled ? (
        <Lock
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 size-3 text-navigation-muted"
        />
      ) : null}
      {!disabled && badgeCount ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-text-inverse"
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </span>
  );

  const tooltip = (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-navigation px-2 py-1 text-xs text-navigation-text opacity-0 shadow-panel transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {tooltipText}
    </span>
  );

  if (disabled) {
    return (
      <span className="group relative flex">
        <button
          type="button"
          aria-disabled="true"
          aria-label={`${label} (unavailable)`}
          className="flex"
        >
          {iconChrome}
        </button>
        {tooltip}
      </span>
    );
  }

  return (
    <span className="group relative flex">
      <Link
        href={href}
        aria-label={badgeCount ? `${label} (${badgeCount})` : label}
        aria-current={active ? "page" : undefined}
        className="flex"
      >
        {iconChrome}
      </Link>
      {tooltip}
    </span>
  );
}

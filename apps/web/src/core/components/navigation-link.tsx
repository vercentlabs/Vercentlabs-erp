"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AppIconName } from "@/shared/components/app-icon";
import SemanticNavigationIcon from "@/core/components/semantic-navigation-icon";
import { matchesPath } from "@/core/navigation/match-path";

export default function NavigationLink({
  href,
  label,
  icon,
  badge,
  mobile = false,
  nested = false,
  exact = false,
  activePrefixes = [],
}: {
  href: string;
  label: string;
  icon: AppIconName;
  badge?: number;
  mobile?: boolean;
  nested?: boolean;
  exact?: boolean;
  activePrefixes?: string[];
}) {
  const pathname = usePathname();
  const active = matchesPath(pathname, { href, exact, activePrefixes });

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`nav-link${active ? " active" : ""}${mobile ? " mobile" : ""}${nested ? " nested" : ""}`}
      href={href}
      title={label}
      // The primary/secondary navigation renders every destination in the
      // active module (often 10-20+ links) simultaneously in the viewport.
      // Next's default Link prefetching fires an RSC prefetch request for
      // every one of them via IntersectionObserver, then aborts and
      // reissues them as navigation state changes — confirmed (CRM vNext
      // Prompt 3) to be the root cause of `networkidle` never settling on
      // CRM list pages, which was silently failing the authenticated
      // browser gate's Leads-table checks. Explicit navigation still
      // fetches the destination on click; this only disables the
      // speculative, viewport-triggered background prefetch.
      prefetch={false}
    >
      <span className="nav-link-icon" aria-hidden="true">
        <SemanticNavigationIcon
          href={href}
          fallback={icon}
          size={nested ? 17 : 19}
        />
      </span>
      <span className="nav-link-label">{label}</span>
      {badge ? (
        <span className="nav-count">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </Link>
  );
}

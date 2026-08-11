"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { matchesPath } from "@/lib/navigation/match-path";

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
    >
      <span className="nav-link-icon" aria-hidden="true">
        <AppIcon name={icon} size={nested ? 17 : 19} />
      </span>
      <span className="nav-link-label">{label}</span>
      {badge ? (
        <span className="nav-count">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";

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
  const primaryMatch = exact
    ? pathname === href
    : href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  const aliasMatch = activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const active = primaryMatch || aliasMatch;

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`nav-link${active ? " active" : ""}${mobile ? " mobile" : ""}${nested ? " nested" : ""}`}
      href={href}
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

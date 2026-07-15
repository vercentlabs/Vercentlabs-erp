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
}: {
  href: string;
  label: string;
  icon: AppIconName;
  badge?: number;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`nav-link${active ? " active" : ""}${mobile ? " mobile" : ""}`}
      href={href}
    >
      <span className="nav-link-icon" aria-hidden="true">
        <AppIcon name={icon} size={19} />
      </span>
      <span className="nav-link-label">{label}</span>
      {badge ? (
        <span className="nav-count">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </Link>
  );
}

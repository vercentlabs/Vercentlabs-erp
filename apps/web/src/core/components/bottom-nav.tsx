"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { matchesPath } from "@/core/navigation/match-path";

// Mobile-only bottom navigation (documented target since Prompt 6's own
// navigation spec, never implemented until now — Part 16). Deliberately
// NOT the desktop sidebar squeezed down: five fixed destinations only.
// "Search" and "Modules" don't navigate directly — they open the existing
// command palette / mobile drawer via the same custom-event pattern those
// components already use for their own external triggers, so this
// component stays decoupled from their internal state.
const ITEMS: Array<{
  key: string;
  label: string;
  icon: "dashboard" | "approvals" | "search" | "modules" | "profile";
  href?: string;
  onActivate?: () => void;
}> = [
  { key: "home", label: "Home", icon: "dashboard", href: "/dashboard" },
  { key: "my-work", label: "My work", icon: "approvals", href: "/my-work" },
  {
    key: "search",
    label: "Search",
    icon: "search",
    onActivate: () => window.dispatchEvent(new CustomEvent("vercentlabs:open-command-palette")),
  },
  {
    key: "modules",
    label: "Modules",
    icon: "modules",
    onActivate: () => window.dispatchEvent(new CustomEvent("vercentlabs:open-mobile-drawer")),
  },
  { key: "profile", label: "Profile", icon: "profile", href: "/profile" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Primary mobile navigation">
      {ITEMS.map((item) => {
        if (item.href) {
          const active = matchesPath(pathname, { href: item.href, exact: item.key === "home" });
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`bottom-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <AppIcon name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            className="bottom-nav-item"
            onClick={item.onActivate}
          >
            <AppIcon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { matchesPath } from "@/core/navigation/match-path";

type BottomItem = {
  key: string;
  label: string;
  icon: "dashboard" | "approvals" | "search" | "modules" | "profile" | "crm" | "sales";
  href?: string;
  exact?: boolean;
  activePrefixes?: string[];
  onActivate?: () => void;
};

const GLOBAL_ITEMS: BottomItem[] = [
  { key: "home", label: "Home", icon: "dashboard", href: "/dashboard", exact: true },
  { key: "my-work", label: "Work", icon: "approvals", href: "/my-work" },
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

/**
 * On CRM routes the mobile navigation follows the user's current task context
 * instead of forcing a round-trip through the global module drawer for every
 * common sales action. "More" deliberately opens the existing permission-
 * resolved drawer, so secondary destinations remain one consistent source of
 * truth rather than another hard-coded menu.
 */
const CRM_ITEMS: BottomItem[] = [
  { key: "crm-overview", label: "Overview", icon: "dashboard", href: "/crm", exact: true },
  { key: "crm-leads", label: "Leads", icon: "crm", href: "/crm/leads" },
  {
    key: "crm-pipeline",
    label: "Pipeline",
    icon: "sales",
    href: "/crm/pipeline",
    activePrefixes: ["/crm/opportunities", "/crm/forecast"],
  },
  { key: "crm-activities", label: "Activities", icon: "approvals", href: "/crm/activities" },
  {
    key: "crm-more",
    label: "More",
    icon: "modules",
    onActivate: () => window.dispatchEvent(new CustomEvent("vercentlabs:open-mobile-drawer")),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const items = pathname === "/crm" || pathname.startsWith("/crm/") ? CRM_ITEMS : GLOBAL_ITEMS;

  return (
    <nav className="bottom-nav" aria-label={items === CRM_ITEMS ? "CRM mobile navigation" : "Primary mobile navigation"}>
      {items.map((item) => {
        if (item.href) {
          const active = matchesPath(pathname, {
            href: item.href,
            exact: item.exact,
            activePrefixes: item.activePrefixes,
          });
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

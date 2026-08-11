"use client";

import { useSyncExternalStore } from "react";

import AppIcon from "@/components/app-icon";
import {
  getSidebarCollapsedServerSnapshot,
  getSidebarCollapsedSnapshot,
  setSidebarCollapsed,
  subscribeSidebarCollapsed,
} from "@/lib/sidebar-collapsed-store";

// A real collapsed/rail desktop sidebar state (Part 14 — previously
// absent: the sidebar was only ever full-width or display:none on mobile,
// nothing in between). Desktop-only by design — the collapsed class is
// scoped to the desktop breakpoint in CSS, so this state is inert on
// tablet/mobile, which use the drawer instead. Labels stay in the DOM
// when collapsed (CSS visually clips them, not display:none), so the
// sidebar remains fully readable by assistive tech either way; each
// NavigationLink also carries a native title tooltip for sighted
// mouse/trackpad users when icon-only.
export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot,
  );

  return (
    <aside
      className={`sidebar${collapsed ? " collapsed" : ""}`}
      aria-label="Primary workspace navigation"
    >
      {children}
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={() => setSidebarCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <AppIcon name="chevron-down" size={14} />
      </button>
    </aside>
  );
}

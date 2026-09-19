"use client";

import { ChevronRight } from "lucide-react";
import type { ModuleAccess } from "@vercentlabs/api";

import { PrimarySidebar } from "@/shell/primary-sidebar/PrimarySidebar";
import { SecondarySidebar } from "./SecondarySidebar";
import {
  SecondarySidebarProvider,
  useSecondarySidebarState,
} from "./SecondarySidebarState";

function ModuleRailInner(props: {
  organizationName: string | null;
  accessibleModules: ModuleAccess[];
  permissions: string[];
  pendingApprovalCount: number;
  unreadNotificationCount: number;
}) {
  const { activeModule, open, pinned, regionHandlers, toggleClickOpen } =
    useSecondarySidebarState();

  return (
    // position:relative + a width that only ever reflects the rail (the
    // flyout is absolutely positioned and out of flow) unless pinned, in
    // which case SecondarySidebar renders as a normal flex child and
    // widens this region for real. onMouseEnter/Leave + onFocus/Blur here
    // (not duplicated per-child) is what lets the cursor or keyboard focus
    // move between the rail and the flyout without the flyout closing.
    <div
      className="relative flex"
      onMouseEnter={regionHandlers.onMouseEnter}
      onMouseLeave={regionHandlers.onMouseLeave}
      onFocus={regionHandlers.onFocus}
      onBlur={regionHandlers.onBlur}
    >
      <PrimarySidebar {...props} />
      <SecondarySidebar />
      {activeModule && !pinned ? (
        <button
          type="button"
          onClick={toggleClickOpen}
          aria-expanded={open}
          aria-label={
            open
              ? `Hide ${activeModule.label} navigation`
              : `Show ${activeModule.label} navigation`
          }
          // Same z-[var(--z-drawer)] as SecondarySidebar's flyout (not a
          // lower tier) — this button sits at the same left-16 edge the
          // flyout occupies when open, and being rendered after it in the
          // DOM is what lets it win that tie and stay clickable while the
          // flyout is open, rather than the flyout's own empty left edge
          // silently swallowing the click.
          className="absolute left-16 top-1/2 z-[var(--z-drawer)] flex h-10 w-3.5 -translate-y-1/2 items-center justify-center rounded-r-[var(--radius-control)] border border-l-0 border-border bg-surface text-text-muted opacity-0 shadow-[var(--shadow-subtle)] transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}
    </div>
  );
}

// Groups the primary icon rail with its module flyout sidebar so they
// share one hover/focus region and one open/pinned state (UI refinement
// addendum requirement #1). Mobile/tablet never renders this component —
// AppShell only mounts it inside its `hidden lg:flex` wrapper.
export function ModuleRail(props: {
  organizationName: string | null;
  accessibleModules: ModuleAccess[];
  permissions: string[];
  pendingApprovalCount: number;
  unreadNotificationCount: number;
}) {
  return (
    <SecondarySidebarProvider>
      <ModuleRailInner {...props} />
    </SecondarySidebarProvider>
  );
}

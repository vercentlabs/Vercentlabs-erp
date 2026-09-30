"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, Pin, PinOff } from "lucide-react";

import {
  activeWorkspaceId,
  sidebarItems,
} from "@/shell/navigation/navigation-resolution";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSecondarySidebarState } from "./SecondarySidebarState";

// Desktop module secondary sidebar (Phase 3; UI refinement addendum
// requirement #1 for the hover/pin behaviour). One section per work area,
// PLANNED items rendered disabled (visible for orientation, never a
// clickable dead link) so the intended IA is legible without pretending
// it's built. Collapses into the mobile drawer's per-module section below
// 1024px rather than showing two simultaneous permanent sidebars — see
// MobileNav.tsx. Must be rendered inside a SecondarySidebarProvider and
// inside the region that wires up regionHandlers (see ModuleRail.tsx).
export function SecondarySidebar() {
  const pathname = usePathname();
  const { permissions, roleSlugs } = useWorkspaceContext();
  const { activeModule, pinned, togglePinned, open } =
    useSecondarySidebarState();
  if (!activeModule) return null;
  // Exactly one workspace is active: the one that owns the most specific
  // registered route (a child route such as /crm/pipeline highlights its
  // parent, Opportunities). Views and configuration pages inside a
  // workspace are never sidebar entries (navigation-resolution.ts), and a
  // workspace the person may not open is not listed at all.
  const activeItemId = activeWorkspaceId(activeModule, pathname);
  const sections = sidebarItems(activeModule, {
    permissions,
    isOwner: roleSlugs.includes("organization_owner"),
  });

  return (
    <nav
      aria-label={`${activeModule.label} navigation`}
      aria-hidden={!open}
      className={
        pinned
          ? "flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface py-4"
          : [
              // Transform-only slide, deliberately never animating opacity:
              // this box's own background must stay fully opaque (rgb(255,
              // 255, 255), not a blended in-between value) at every single
              // frame of the transition, or a slow/busy paint can catch it
              // mid-fade and visibly blend with the page content sitting
              // behind it (found via a real repro: page content bled through
              // the flyout during its open animation). Closed state moves
              // the whole box off past the rail's left edge instead of
              // fading it — off-screen, not see-through.
              //
              // z-[var(--z-drawer)] (40), not z-20: the page content this
              // flyout overlays can contain its OWN positioned elements —
              // EnterpriseDataGrid's sticky table header is z-[var(--z-sticky)]
              // (also 20). Equal z-index ties break by DOM order, and the
              // table (rendered later, inside the main content sibling)
              // was winning, painting its sticky header's checkbox/label
              // cell literally on top of this flyout (reported via
              // screenshot: a lead-list column header bleeding into the
              // sidebar). This flyout is conceptually a drawer overlay, so
              // it must always outrank ordinary in-page sticky content.
              "absolute left-16 top-0 bottom-0 z-[var(--z-drawer)] flex w-[240px] flex-col overflow-y-auto border-r border-border bg-surface py-4 shadow-[var(--shadow-subtle)]",
              "transition-transform duration-150 ease-out",
              open
                ? "translate-x-0"
                : "pointer-events-none -translate-x-[calc(100%+4rem)]",
            ].join(" ")
      }
    >
      <div className="flex items-center justify-between px-4 pb-3">
        <h2 className="text-sm font-semibold text-text">
          {activeModule.label}
        </h2>
        <button
          type="button"
          onClick={togglePinned}
          aria-pressed={pinned}
          tabIndex={open ? 0 : -1}
          className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-muted hover:text-text"
          title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
        >
          {pinned ? (
            <PinOff aria-hidden="true" className="size-3.5" />
          ) : (
            <Pin aria-hidden="true" className="size-3.5" />
          )}
          <span className="sr-only">
            {pinned ? "Unpin sidebar" : "Pin sidebar open"}
          </span>
        </button>
      </div>
      <div className="flex flex-col gap-4 px-2">
        {sections.map((section) => (
          <div key={section.id}>
            <p className="px-2 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                // sidebarItems() already dropped AVAILABLE items the person
                // may not open; what remains is either a live workspace or
                // a PLANNED placeholder rendered disabled below.
                if (item.status === "AVAILABLE") {
                  const active = item.id === activeItemId;
                  return (
                    <Link
                      key={item.id}
                      href={item.route}
                      aria-current={active ? "page" : undefined}
                      tabIndex={open ? 0 : -1}
                      className={[
                        "rounded-[var(--radius-control)] px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-brand-soft font-medium text-brand"
                          : "text-text hover:bg-surface-muted",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  );
                }
                return (
                  <span
                    key={item.id}
                    className="flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1.5 text-sm text-text-secondary"
                    title="Planned — not yet built"
                  >
                    {item.label}
                    <Lock aria-hidden="true" className="size-3" />
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

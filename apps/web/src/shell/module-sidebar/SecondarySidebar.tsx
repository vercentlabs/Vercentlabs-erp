"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, Pin, PinOff } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSecondarySidebarState } from "./SecondarySidebarState";

function isActiveRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

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
  const { permissions } = useWorkspaceContext();
  const { activeModule, pinned, togglePinned, open } =
    useSecondarySidebarState();
  if (!activeModule) return null;

  return (
    <nav
      aria-label={`${activeModule.label} navigation`}
      aria-hidden={!open}
      className={
        pinned
          ? "flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface py-4"
          : [
              "absolute left-16 top-0 bottom-0 z-20 flex w-[240px] flex-col overflow-y-auto border-r border-border bg-surface py-4 shadow-[var(--shadow-subtle)]",
              "transition-[opacity,transform] duration-150 ease-out",
              open
                ? "translate-x-0 opacity-100"
                : "pointer-events-none -translate-x-2 opacity-0",
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
        {activeModule.sections.map((section) => (
          <div key={section.id}>
            <p className="px-2 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const available = item.status === "AVAILABLE";
                const permitted =
                  !item.requiredPermission ||
                  permissions.includes(item.requiredPermission);
                // Checkpoint C fix (ERP completion gap register): this must
                // gate on both available AND permitted — an available item
                // the user lacks permission for renders the disabled/locked
                // state below, never a live Link.
                if (available && permitted) {
                  const active = isActiveRoute(pathname, item.route);
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
                    className="flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1.5 text-sm text-text-muted opacity-60"
                    title={
                      permitted
                        ? "Planned — not yet built"
                        : "Requires additional permission once built"
                    }
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

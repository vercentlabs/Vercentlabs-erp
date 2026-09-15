"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

function isActiveRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function findActiveModule(pathname: string) {
  return MODULE_NAVIGATION.find((entry) => {
    const overview = entry.sections[0]?.items[0]?.route;
    return overview ? isActiveRoute(pathname, overview) : false;
  });
}

// Desktop-persistent secondary sidebar (Phase 3) — one section per work
// area, PLANNED items rendered disabled (visible for orientation, never a
// clickable dead link) so the intended IA is legible without pretending
// it's built. Collapses into the mobile drawer's per-module section below
// 1024px rather than showing two simultaneous permanent sidebars — see
// MobileNav.tsx.
export function SecondarySidebar() {
  const pathname = usePathname();
  const { permissions } = useWorkspaceContext();
  const activeModule = findActiveModule(pathname);
  if (!activeModule) return null;

  return (
    <nav
      aria-label={`${activeModule.label} navigation`}
      className="hidden w-[240px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface py-4 lg:flex"
    >
      <div className="px-4 pb-3">
        <h2 className="text-sm font-semibold text-text">
          {activeModule.label}
        </h2>
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
                if (available) {
                  const active = isActiveRoute(pathname, item.route);
                  return (
                    <Link
                      key={item.id}
                      href={item.route}
                      aria-current={active ? "page" : undefined}
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

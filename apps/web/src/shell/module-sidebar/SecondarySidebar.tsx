"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Lock, Pin, PinOff } from "lucide-react";

import {
  activeWorkspaceId,
  sidebarItems,
} from "@/shell/navigation/navigation-resolution";
import type { ModuleNavigation } from "@/shell/navigation/navigation-types";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SIDEBAR_BADGES } from "./sidebar-badges";
import { useSecondarySidebarState } from "./SecondarySidebarState";

// Desktop module secondary sidebar (with hover/pin behaviour). One section per work area,
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
  const viewer = { permissions, isOwner: roleSlugs.includes("organization_owner") };

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
      <Suspense fallback={<SidebarBody module={activeModule} pathname={pathname} search="" open={open} viewer={viewer} />}>
        <SidebarBodyWithQuery module={activeModule} pathname={pathname} open={open} viewer={viewer} />
      </Suspense>
    </nav>
  );
}

type Viewer = { permissions: readonly string[]; isOwner: boolean };

const STORAGE_EVENT = "vercent-sidebar-storage";
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
  };
}
// Modules whose sections all start open on every visit: a section the person folds stays folded only for this browser tab (session
// storage), so the next visit shows every section open again. Other modules start folded and remember what was opened (local storage).
const OPEN_ON_ARRIVAL = new Set(["crm", "sales", "procurement", "stock"]);
function sidebarStorage(moduleKey: string): Storage {
  return OPEN_ON_ARRIVAL.has(moduleKey) ? window.sessionStorage : window.localStorage;
}
function readStorage(moduleKey: string, key: string): string | null {
  try {
    return sidebarStorage(moduleKey).getItem(key);
  } catch {
    return null;
  }
}
function parseOpened(raw: string | null): Record<string, boolean> {
  try {
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function SidebarBodyWithQuery(props: { module: ModuleNavigation; pathname: string; open: boolean; viewer: Viewer }) {
  const search = useSearchParams()?.toString() ?? "";
  return <SidebarBody {...props} search={search} />;
}

// One section per work area. A flat section is a single link; a collapsible one folds its items under its label — open while one of them
// is active, when the person opens it, or by default in the modules listed in OPEN_ON_ARRIVAL. PLANNED items render disabled, never as dead links.
// Items with a badge show the module's attention count (sidebar-badges.ts).
function SidebarBody({ module, pathname, search, open, viewer }: { module: ModuleNavigation; pathname: string; search: string; open: boolean; viewer: Viewer }) {
  const workspace = useWorkspaceContext();
  // Exactly one workspace is active: the one that owns the most specific registered route (a child route such as /crm/pipeline highlights
  // its parent, Opportunities; items sharing a path are told apart by their query). Views and configuration pages inside a workspace are
  // never sidebar entries (navigation-resolution.ts), and a workspace the person may not open is not listed at all.
  const activeItemId = activeWorkspaceId(module, pathname, search);
  const sections = sidebarItems(module, viewer);
  const reader = SIDEBAR_BADGES[module.moduleKey];
  const badges: Record<string, string> = useQuery({
    queryKey: scopedQueryKey(workspace, "sidebar-badges", module.moduleKey),
    queryFn: (): Promise<Record<string, string>> => (reader ? reader() : Promise.resolve({})),
    enabled: Boolean(reader),
    refetchInterval: 60_000,
    staleTime: 30_000,
  }).data ?? {};
  const storageKey = `vercent.sidebar.open.${module.moduleKey}`;
  // Which folded sections the person opened: remembered in this browser (read through useSyncExternalStore, so the server render and the
  // first client render agree), kept in memory when storage is unavailable.
  const [memory, setMemory] = useState<Record<string, boolean>>({});
  const stored = useSyncExternalStore(subscribeStorage, () => readStorage(module.moduleKey, storageKey), () => null);
  const opened: Record<string, boolean> = { ...parseOpened(stored), ...memory };
  const openByDefault = OPEN_ON_ARRIVAL.has(module.moduleKey);
  const toggle = (id: string, next: boolean) => {
    const value = { ...opened, [id]: next };
    setMemory(value);
    try {
      sidebarStorage(module.moduleKey).setItem(storageKey, JSON.stringify(value));
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch {
      // Storage unavailable: the in-memory state above keeps it for this page.
    }
  };
  const tab = open ? 0 : -1;
  const linkClass = (active: boolean) =>
    [
      "flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-sm transition-colors",
      active ? "bg-brand-soft font-medium text-brand" : "text-text hover:bg-surface-muted",
    ].join(" ");
  const badgeOf = (key?: string) =>
    key && badges[key] ? (
      <span
        className={`min-w-5 rounded-full px-1.5 text-center text-xs font-medium tabular-nums ${badges[key] === "!" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}
      >
        {badges[key]}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-4 px-2">
      {sections.map((section) => {
        const Icon = section.icon;
        const first = section.items[0];
        if (section.flat && section.items.length === 1 && first.status === "AVAILABLE") {
          const active = first.id === activeItemId;
          return (
            <Link key={section.id} href={first.route} aria-current={active ? "page" : undefined} tabIndex={tab} className={linkClass(active)}>
              <span className="flex items-center gap-2">
                {Icon && <Icon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />}
                {first.label}
              </span>
              {badgeOf(first.badge)}
            </Link>
          );
        }
        const containsActive = section.items.some((item) => item.id === activeItemId);
        const expanded = !section.collapsible || containsActive || (opened[section.id] ?? openByDefault);
        const foldedBadge = section.collapsible && !expanded ? section.items.map((item) => badgeOf(item.badge)).find(Boolean) : null;
        return (
          <div key={section.id}>
            {section.collapsible ? (
              <button
                type="button"
                tabIndex={tab}
                aria-expanded={expanded}
                onClick={() => toggle(section.id, !expanded)}
                className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm font-medium text-text hover:bg-surface-muted"
              >
                <span className="flex items-center gap-2">
                  {Icon && <Icon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />}
                  {section.label}
                </span>
                <span className="flex items-center gap-1">
                  {foldedBadge}
                  {expanded ? <ChevronDown aria-hidden="true" className="size-3.5 text-text-muted" /> : <ChevronRight aria-hidden="true" className="size-3.5 text-text-muted" />}
                </span>
              </button>
            ) : (
              <p className="flex items-center gap-2 px-2 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
                {Icon && <Icon aria-hidden="true" className="size-3.5" />}
                {section.label}
              </p>
            )}
            {expanded && (
              <div className={`flex flex-col gap-0.5 ${section.collapsible ? "pl-6" : ""}`}>
                {section.items.map((item) => {
                  // sidebarItems() already dropped AVAILABLE items the person
                  // may not open; what remains is either a live workspace or
                  // a PLANNED placeholder rendered disabled below.
                  if (item.status === "AVAILABLE") {
                    const active = item.id === activeItemId;
                    return (
                      <Link key={item.id} href={item.route} aria-current={active ? "page" : undefined} tabIndex={tab} className={linkClass(active)}>
                        <span>{item.label}</span>
                        {badgeOf(item.badge)}
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
            )}
          </div>
        );
      })}
    </div>
  );
}

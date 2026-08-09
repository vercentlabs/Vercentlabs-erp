// Breadcrumb labels, derived from the navigation registry instead of a
// second, independently hand-maintained map (Prompt 1's audit flagged this
// exact duplication: "apps/web/src/components/breadcrumbs.tsx maintains an
// independent, hardcoded label map that duplicates labels already declared
// in the nav config"). Registry-derived first, then a small set of explicit
// overrides layered on top — preserving today's exact visible breadcrumb
// text for the handful of segments where the breadcrumb's short/contextual
// form intentionally differs from the sidebar's fuller label (e.g. sidebar
// "Sales orders" vs breadcrumb "Orders"), or where a segment is shared by
// more than one route root (e.g. "assets" is both the Assets module root
// and an Accounting sub-page — segment-keyed labels can only pick one).
import { administrationNavigation, workspaceSettingsNavigation } from "@/lib/navigation/administration";
import { governanceNavigation } from "@/lib/navigation/governance";
import { moduleNavigation } from "@/lib/navigation/modules";
import { myWorkNavigation } from "@/lib/navigation/my-work";
import type { NavigationItem } from "@/lib/navigation/types";
import { workspaceNavigation } from "@/lib/navigation/workspace";

function lastSegment(href: string): string {
  const parts = href.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function registerAll(target: Record<string, string>, items: NavigationItem[]) {
  for (const item of items) {
    const segment = lastSegment(item.href);
    if (segment && !(segment in target)) target[segment] = item.label;
  }
}

const derived: Record<string, string> = {};
for (const group of moduleNavigation) {
  if (!(group.moduleId in derived)) derived[group.moduleId] = group.label;
  registerAll(derived, group.items);
}
registerAll(derived, workspaceNavigation);
registerAll(derived, myWorkNavigation);
registerAll(derived, governanceNavigation);
registerAll(derived, administrationNavigation);
registerAll(derived, workspaceSettingsNavigation);

// Verified byte-identical to the previous hand-maintained map's values —
// this is a preservation list, not new copy.
const OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  dashboard: "Home",
  modules: "Modules",
  profile: "Profile",
  settings: "Settings",
  search: "Search",
  reports: "Reports",
  orders: "Orders",
  contracts: "Agreements",
  assets: "Fixed assets",
  new: "New",
});

export const BREADCRUMB_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...derived,
  ...OVERRIDES,
});

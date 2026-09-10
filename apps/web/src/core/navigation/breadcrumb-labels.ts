// Breadcrumb labels, derived from the navigation registry instead of a
// second, independently hand-maintained map (Prompt 1's audit flagged this
// exact duplication: "apps/web/src/core/components/breadcrumbs.tsx maintains an
// independent, hardcoded label map that duplicates labels already declared
// in the nav config"). Registry-derived first, then a small set of explicit
// overrides layered on top — preserving today's exact visible breadcrumb
// text for the handful of segments where the breadcrumb's short/contextual
// form intentionally differs from the sidebar's fuller label (e.g. sidebar
// "Sales orders" vs breadcrumb "Orders"), or where a segment is shared by
// more than one route root (e.g. "assets" is both the Assets module root
// and an Accounting sub-page — segment-keyed labels can only pick one).
import { administrationNavigation, workspaceSettingsNavigation } from "@/core/navigation/administration";
import { governanceNavigation } from "@/core/navigation/governance";
import { moduleNavigation } from "@/core/navigation/modules";
import { myWorkNavigation } from "@/core/navigation/my-work";
import type { NavigationItem } from "@/core/navigation/types";
import { workspaceNavigation } from "@/core/navigation/workspace";

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
  // CRM setup hub (apps/web/src/app/(app)/crm/settings/page.tsx): these
  // resource segments are reachable only through that hub's cards, not the
  // primary nav registry, so they were rendering as raw lowercase-with-
  // hyphens breadcrumb text. Labels copied verbatim from that page's
  // `groups` array.
  sources: "Lead sources",
  "lead-lifecycle": "Lead lifecycle",
  "assignment-rules": "Assignment rules",
  "scoring-rules": "Lead scoring (legacy)",
  "lead-scoring": "Lead scoring",
  "qualification-criteria": "Qualification criteria",
  pipelines: "Pipelines",
  stages: "Sales stages",
  "lost-reasons": "Won / lost reasons",
  "sales-teams": "Sales teams",
  "sales-team-members": "Team members",
  territories: "Territories",
  "territory-assignments": "Territory assignments",
  tags: "Tags",
  "custom-object-definitions": "Custom objects",
  "custom-field-definitions": "Custom fields",
  "custom-records": "Custom records",
  calendar: "Calendar",
  features: "All CRM features",
  "data-management": "Data management",
  "quota-plans": "Quotas",
  "duplicate-rules": "Duplicate detection rules",
});

export const BREADCRUMB_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...derived,
  ...OVERRIDES,
});

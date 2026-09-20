// The single GLOBAL navigation authority — primary sidebar, mobile drawer,
// and (in a later prompt) the command menu must all read from this file
// for Home/Work/Search/Approvals/Notifications/Jobs/Help/Settings and from
// module-navigation-registry.ts's MODULE_NAVIGATION for the 12 modules'
// own entries. MODULE_NAV_ENTRIES below is DERIVED from MODULE_NAVIGATION
// (icon/label/route), never hand-duplicated — Phase 2's explicit
// "one registry must be the authority" rule.
import {
  Home,
  ListChecks,
  Search,
  CheckSquare,
  Bell,
  ListTodo,
  HelpCircle,
  Settings,
  UserRound,
} from "lucide-react";

import { MODULE_NAVIGATION } from "./module-navigation-registry";
import type { NavIcon } from "./navigation-types";

export type { NavIcon };

export type NavAvailability = "implemented" | "foundation" | "planned";

export type ModuleNavEntry = {
  moduleKey: string;
  label: string;
  href: string;
  icon: NavIcon;
  requiredPermission: string;
  availability: NavAvailability;
  keywords: string[];
};

export const MODULE_NAV_ENTRIES: readonly ModuleNavEntry[] =
  MODULE_NAVIGATION.map((module) => {
    const overview = module.sections[0]?.items[0];
    return {
      moduleKey: module.moduleKey,
      label: module.label,
      href: overview?.route ?? `/${module.moduleKey}`,
      icon: module.icon,
      requiredPermission: module.requiredPermission,
      availability: "foundation",
      keywords: [module.label.toLowerCase()],
    };
  });

export type GlobalNavEntry = {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** null = no permission required beyond an authenticated workspace session. */
  requiredPermission: string | null;
  availability: NavAvailability;
  keywords: string[];
  /** Only an actionable count may be a badge source — never a decorative volume count. */
  badgeSource?: "pendingApprovals" | "unreadNotifications";
  /** "topbar" = desktop renders this in WorkspaceTopBar instead of the primary
   * sidebar. The mobile drawer and breadcrumbs still list every entry. */
  placement?: "topbar";
};

export const GLOBAL_NAV_TOP: readonly GlobalNavEntry[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    icon: Home,
    requiredPermission: null,
    availability: "implemented",
    keywords: ["home", "dashboard"],
  },
  {
    key: "work",
    label: "Work",
    href: "/work",
    icon: ListChecks,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["my work", "tasks", "assigned"],
  },
  {
    key: "search",
    label: "Search",
    href: "/search",
    icon: Search,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["search", "find"],
    placement: "topbar",
  },
];

export const GLOBAL_NAV_BOTTOM: readonly GlobalNavEntry[] = [
  {
    key: "approvals",
    label: "Approvals",
    href: "/approvals",
    icon: CheckSquare,
    requiredPermission: "approvals.manage",
    availability: "implemented",
    keywords: ["approvals", "inbox"],
    badgeSource: "pendingApprovals",
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
    requiredPermission: null,
    availability: "implemented",
    keywords: ["notifications", "alerts"],
    badgeSource: "unreadNotifications",
  },
  {
    key: "my-hr",
    label: "My HR",
    href: "/hr/me",
    icon: UserRound,
    requiredPermission: null,
    availability: "implemented",
    keywords: ["my hr", "my profile", "my leave", "my attendance", "payslip", "self service"],
  },
  {
    key: "jobs",
    label: "Background Jobs",
    href: "/jobs",
    icon: ListTodo,
    requiredPermission: null,
    availability: "implemented",
    keywords: ["jobs", "background jobs", "imports"],
  },
];

export const UTILITY_NAV: readonly GlobalNavEntry[] = [
  {
    key: "help",
    label: "Help",
    href: "/help",
    icon: HelpCircle,
    requiredPermission: null,
    availability: "planned",
    keywords: ["help", "support"],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["settings", "administration"],
    placement: "topbar",
  },
];

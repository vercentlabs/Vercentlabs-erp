import { PERMISSIONS } from "@/lib/permissions-catalog";
import type { NavigationItem } from "@/lib/navigation/types";

// MY WORK. Prompt 8 (Shared Workspace Foundation) adds My Work, Tasks,
// Follow-ups & Reminders, Exceptions, Recent Records and Favourites — real
// routes backed by read-oriented cross-module aggregation adapters (see
// apps/web/src/lib/my-work/*). No permission gate on these: each aggregates
// only what the caller's existing module/permission/record-scope access
// already allows, so an unentitled user simply sees an empty state rather
// than being blocked at the nav level (see docs/implementation/
// ERP_SHARED_WORKSPACE_008.md Section 3).
export const myWorkNavigation: NavigationItem[] = [
  { href: "/my-work", label: "My work", icon: "dashboard" },
  {
    href: "/tasks",
    label: "Tasks",
    icon: "approvals",
    keywords: ["todo", "to-do"],
  },
  {
    href: "/follow-ups",
    label: "Follow-ups & reminders",
    icon: "notifications",
    keywords: ["reminder", "reminders"],
  },
  {
    href: "/exceptions",
    label: "Exceptions",
    icon: "security",
    keywords: ["issues", "issue"],
  },
  {
    href: "/recent",
    label: "Recent records",
    icon: "search",
    keywords: ["recent"],
  },
  {
    href: "/favourites",
    label: "Favourites",
    icon: "sparkles",
    keywords: ["saved", "favorites", "starred"],
  },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "approvals",
    permission: PERMISSIONS.approvalsManage,
  },
];

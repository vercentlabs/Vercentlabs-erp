import { PERMISSIONS } from "@/core/permissions";
import type { NavigationItem } from "@/core/navigation/types";

// MY WORK. Prompt 8 (Shared Workspace Foundation) adds My Work, Tasks,
// Follow-ups & Reminders and Exceptions — real
// routes backed by read-oriented cross-module aggregation adapters (see
// apps/web/src/orchestration/work/*). No permission gate on these: each aggregates
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
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "approvals",
    permission: PERMISSIONS.approvalsManage,
  },
];

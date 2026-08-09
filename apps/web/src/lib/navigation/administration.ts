import { PERMISSIONS } from "@/lib/permissions-catalog";
import type { NavigationItem, NavigationSectionData } from "@/lib/navigation/types";

// ADMINISTRATION > Workspace Settings (existing /settings/* sub-pages,
// unchanged) + Security (a real /security route that previously had no
// sidebar entry at all — only a topbar icon; added here since it's a real,
// already-shipped page, not a new one). Target IA also names Automation,
// Reports & Analytics, Integrations, and Data Management — no real routes
// exist for any of them today; omitted per Part 8. See the Route Gap Matrix
// in docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md.
export const workspaceSettingsNavigation: NavigationItem[] = [
  { href: "/settings", label: "Overview", icon: "dashboard", exact: true },
  {
    href: "/settings/organization",
    label: "Organisation",
    icon: "organisation",
    permission: PERMISSIONS.organizationManage,
  },
  {
    href: "/settings/companies",
    label: "Companies",
    icon: "companies",
    permission: PERMISSIONS.companyManage,
  },
  {
    href: "/settings/branches",
    label: "Branches",
    icon: "branches",
    permission: PERMISSIONS.branchManage,
  },
  {
    href: "/settings/departments",
    label: "Departments",
    icon: "departments",
    permission: PERMISSIONS.departmentManage,
  },
  {
    href: "/settings/teams",
    label: "Teams",
    icon: "teams",
    permission: PERMISSIONS.teamManage,
  },
  {
    href: "/settings/cost-centres",
    label: "Cost centres",
    icon: "cost-centres",
    permission: PERMISSIONS.costCenterManage,
  },
  {
    href: "/settings/users",
    label: "Users",
    icon: "users",
    permission: PERMISSIONS.usersView,
  },
  {
    href: "/settings/roles",
    label: "Roles & permissions",
    icon: "roles",
    permission: PERMISSIONS.rolesView,
  },
  {
    href: "/settings/numbering-series",
    label: "Numbering series",
    icon: "numbering",
    permission: PERMISSIONS.numberingManage,
  },
];

// A flat top-level Administration item (Security) alongside the
// Workspace Settings capability group — matches the target IA's shape,
// where Administration has both group destinations (Workspace Settings)
// and standalone leaves (Security).
export const administrationNavigation: NavigationItem[] = [
  { href: "/security", label: "Security", icon: "security" },
];

export const workspaceSettingsSection: NavigationSectionData = {
  id: "workspace-settings",
  label: "Workspace settings",
  items: workspaceSettingsNavigation,
};

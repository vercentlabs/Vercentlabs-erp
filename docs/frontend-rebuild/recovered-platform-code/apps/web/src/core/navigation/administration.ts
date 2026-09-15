import { PERMISSIONS } from "@/core/permissions";
import type { NavigationItem, NavigationSectionData } from "@/core/navigation/types";

// ADMINISTRATION > Workspace Settings (existing /settings/* sub-pages,
// unchanged) + Security, Reports & Analytics, Integrations,
// Data Management (Prompt 10 — all six target destinations now have a
// real route). Each new item's `keywords` cover its real in-page
// sub-destinations (same "one flat destination per workspace, no
// duplicated sidebar tree" pattern Billing/Audit Logs/Compliance already
// established in Prompts 9) so the command palette can find them without
// a second, parallel navigation tree (Part 60).
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

// Flat top-level Administration items alongside the Workspace Settings
// capability group — matches the target IA's shape, where Administration
// has both group destinations (Workspace Settings) and standalone leaves.
export const administrationNavigation: NavigationItem[] = [
  {
    href: "/security",
    label: "Security",
    icon: "security",
    keywords: [
      "authentication",
      "mfa",
      "sessions",
      "record-level access",
      "field-level access",
      "segregation of duties",
      "maker-checker",
      "security logs",
    ],
  },
  {
    href: "/reports",
    label: "Reports & analytics",
    icon: "audit",
    keywords: ["reports", "analytics", "dashboards", "saved views"],
  },
  {
    href: "/integrations",
    label: "Integrations",
    icon: "billing",
    permission: PERMISSIONS.integrationsView,
    keywords: ["api", "webhook", "oauth", "developer", "apps"],
  },
  {
    href: "/data-management",
    label: "Data management",
    icon: "stock",
    permission: PERMISSIONS.dataManagementView,
    keywords: ["import", "export", "bulk update", "duplicates", "data"],
  },
];

export const workspaceSettingsSection: NavigationSectionData = {
  id: "workspace-settings",
  label: "Workspace settings",
  items: workspaceSettingsNavigation,
};

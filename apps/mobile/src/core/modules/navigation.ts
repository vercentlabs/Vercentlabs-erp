import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import type { Href } from "expo-router";

export type WorkspaceDestination = {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  permission?: string;
  href: Href;
};

export const workspaceNavigation: readonly WorkspaceDestination[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "speedometer-outline",
    href: "/(protected)/(tabs)",
  },
  {
    key: "crm",
    label: "CRM",
    icon: "people-outline",
    permission: "crm.view",
    href: "/(protected)/workspace/crm",
  },
  {
    key: "crm-customer-success",
    label: "Customer success",
    icon: "pulse-outline",
    permission: "crm.view",
    href: "/(protected)/workspace/crm-customer-success",
  },
  {
    key: "crm-communications",
    label: "Communications",
    icon: "mail-unread-outline",
    permission: "crm.view",
    href: "/(protected)/workspace/crm-communications",
  },
  {
    key: "crm-conversation-intelligence",
    label: "Calls & transcripts",
    icon: "call-outline",
    permission: "crm.view",
    href: "/(protected)/workspace/crm-conversation-intelligence",
  },
  {
    key: "crm-lead-acquisition",
    label: "Lead acquisition",
    icon: "funnel-outline",
    permission: "crm.view",
    href: "/(protected)/workspace/crm-lead-acquisition",
  },
  {
    key: "crm-marketing",
    label: "Marketing",
    icon: "megaphone-outline",
    permission: "crm.view",
    href: "/(protected)/workspace/crm-marketing",
  },
  {
    key: "master-data",
    label: "Master data",
    icon: "server-outline",
    permission: "business_data.view",
    href: "/(protected)/workspace/master-data",
  },
  {
    key: "modules",
    label: "Modules",
    icon: "apps-outline",
    href: "/(protected)/workspace/modules",
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: "notifications-outline",
    href: "/(protected)/notifications",
  },
  {
    key: "billing",
    label: "Billing",
    icon: "card-outline",
    permission: "billing.view",
    href: "/(protected)/workspace/billing",
  },
  {
    key: "audit-logs",
    label: "Audit logs",
    icon: "reader-outline",
    permission: "audit.view",
    href: "/(protected)/workspace/audit-logs",
  },
];

export const administrationNavigation: readonly WorkspaceDestination[] = [
  {
    key: "organization",
    label: "Organisation",
    icon: "business-outline",
    permission: "organization.manage",
    href: "/(protected)/workspace/settings/organization",
  },
  {
    key: "companies",
    label: "Companies",
    icon: "briefcase-outline",
    permission: "company.manage",
    href: "/(protected)/workspace/settings/companies",
  },
  {
    key: "branches",
    label: "Branches",
    icon: "git-branch-outline",
    permission: "branch.manage",
    href: "/(protected)/workspace/settings/branches",
  },
  {
    key: "departments",
    label: "Departments",
    icon: "layers-outline",
    permission: "department.manage",
    href: "/(protected)/workspace/settings/departments",
  },
  {
    key: "teams",
    label: "Teams",
    icon: "people-circle-outline",
    permission: "team.manage",
    href: "/(protected)/workspace/settings/teams",
  },
  {
    key: "cost-centres",
    label: "Cost centres",
    icon: "pie-chart-outline",
    permission: "cost_center.manage",
    href: "/(protected)/workspace/settings/cost-centres",
  },
  {
    key: "users",
    label: "Users",
    icon: "person-add-outline",
    permission: "users.view",
    href: "/(protected)/workspace/users",
  },
  {
    key: "roles",
    label: "Roles & permissions",
    icon: "key-outline",
    permission: "roles.manage",
    href: "/(protected)/workspace/roles",
  },
  {
    key: "numbering-series",
    label: "Numbering series",
    icon: "list-outline",
    permission: "numbering.manage",
    href: "/(protected)/workspace/settings/numbering-series",
  },
];

export const accountNavigation: readonly WorkspaceDestination[] = [
  {
    key: "approvals",
    label: "Approvals",
    icon: "checkmark-done-outline",
    permission: "approvals.manage",
    href: "/(protected)/workspace/approvals",
  },
  {
    key: "profile",
    label: "Profile",
    icon: "person-circle-outline",
    permission: "profile.manage",
    href: "/(protected)/workspace/profile",
  },
  {
    key: "security",
    label: "Security",
    icon: "shield-checkmark-outline",
    href: "/(protected)/workspace/security",
  },
];

export function visibleDestinations(
  items: readonly WorkspaceDestination[],
  permissions: readonly string[],
) {
  const allowed = new Set(permissions);
  return items.filter(
    (item) => !item.permission || allowed.has(item.permission),
  );
}

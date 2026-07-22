import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type WorkspaceDestination = {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  permission?: string;
  href?: "/(protected)/(tabs)" | "/(protected)/(tabs)/leads" | "/(protected)/(tabs)/modules" | "/(protected)/notifications" | "/(protected)/search";
  availability: "native" | "web-required";
};

export const workspaceNavigation: readonly WorkspaceDestination[] = [
  { key: "dashboard", label: "Dashboard", icon: "speedometer-outline", href: "/(protected)/(tabs)", availability: "native" },
  { key: "crm", label: "CRM", icon: "people-outline", permission: "crm.view", href: "/(protected)/(tabs)/leads", availability: "native" },
  { key: "master-data", label: "Master data", icon: "server-outline", permission: "business_data.view", availability: "web-required" },
  { key: "modules", label: "Modules", icon: "apps-outline", href: "/(protected)/(tabs)/modules", availability: "native" },
  { key: "notifications", label: "Notifications", icon: "notifications-outline", href: "/(protected)/notifications", availability: "native" },
  { key: "billing", label: "Billing", icon: "card-outline", permission: "billing.view", availability: "web-required" },
  { key: "audit-logs", label: "Audit logs", icon: "reader-outline", permission: "audit.view", availability: "web-required" },
];

export const administrationNavigation: readonly WorkspaceDestination[] = [
  { key: "organization", label: "Organisation", icon: "business-outline", permission: "organization.manage", availability: "web-required" },
  { key: "companies", label: "Companies", icon: "briefcase-outline", permission: "company.manage", availability: "web-required" },
  { key: "branches", label: "Branches", icon: "git-branch-outline", permission: "branch.manage", availability: "web-required" },
  { key: "departments", label: "Departments", icon: "layers-outline", permission: "department.manage", availability: "web-required" },
  { key: "teams", label: "Teams", icon: "people-circle-outline", permission: "team.manage", availability: "web-required" },
  { key: "cost-centres", label: "Cost centres", icon: "pie-chart-outline", permission: "cost_center.manage", availability: "web-required" },
  { key: "users", label: "Users", icon: "person-add-outline", permission: "users.view", availability: "web-required" },
  { key: "roles", label: "Roles & permissions", icon: "key-outline", permission: "roles.manage", availability: "web-required" },
  { key: "numbering-series", label: "Numbering series", icon: "list-outline", permission: "numbering.manage", availability: "web-required" },
];

export function visibleDestinations(items: readonly WorkspaceDestination[], permissions: readonly string[]) {
  const allowed = new Set(permissions);
  return items.filter((item) => !item.permission || allowed.has(item.permission));
}

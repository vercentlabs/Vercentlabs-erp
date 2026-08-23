import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";

export const metadata = { title: "Settings" };

const items: Array<{
  label: string;
  href: string;
  description: string;
  icon: AppIconName;
  group: "Structure" | "Access" | "Controls" | "Platform";
  permission: string;
}> = [
  {
    label: "Organisation",
    href: "/settings/organization",
    description: "Workspace identity and operating defaults",
    icon: "organisation",
    group: "Structure",
    permission: PERMISSIONS.organizationManage,
  },
  {
    label: "Companies",
    href: "/settings/companies",
    description: "Legal entities and fiscal configuration",
    icon: "companies",
    group: "Structure",
    permission: PERMISSIONS.companyManage,
  },
  {
    label: "Branches",
    href: "/settings/branches",
    description: "Operating locations and company assignment",
    icon: "branches",
    group: "Structure",
    permission: PERMISSIONS.branchManage,
  },
  {
    label: "Departments",
    href: "/settings/departments",
    description: "Responsibility and reporting units",
    icon: "departments",
    group: "Structure",
    permission: PERMISSIONS.departmentManage,
  },
  {
    label: "Teams",
    href: "/settings/teams",
    description: "Cross-functional groups and ownership",
    icon: "teams",
    group: "Structure",
    permission: PERMISSIONS.teamManage,
  },
  {
    label: "Cost centres",
    href: "/settings/cost-centres",
    description: "Cost accountability and reporting structure",
    icon: "cost-centres",
    group: "Structure",
    permission: PERMISSIONS.costCenterManage,
  },
  {
    label: "Users",
    href: "/settings/users",
    description: "Invitations, status and operating access",
    icon: "users",
    group: "Access",
    permission: PERMISSIONS.usersView,
  },
  {
    label: "Roles & permissions",
    href: "/settings/roles",
    description: "Least-privilege roles and capabilities",
    icon: "roles",
    group: "Access",
    permission: PERMISSIONS.rolesView,
  },
  {
    label: "Numbering series",
    href: "/settings/numbering-series",
    description: "Consistent identifiers for business records",
    icon: "numbering",
    group: "Controls",
    permission: PERMISSIONS.numberingManage,
  },
  {
    label: "Security",
    href: "/security",
    description: "Password, sessions and organisation security overview",
    icon: "security",
    group: "Platform",
    permission: PERMISSIONS.workspaceView,
  },
  {
    label: "Reports & analytics",
    href: "/reports",
    description: "Discover real reports across accessible modules",
    icon: "audit",
    group: "Platform",
    permission: PERMISSIONS.workspaceView,
  },
  {
    label: "Integrations",
    href: "/integrations",
    description: "Payments, outbound webhooks and system email status",
    icon: "billing",
    group: "Platform",
    permission: PERMISSIONS.integrationsView,
  },
  {
    label: "Data management",
    href: "/data-management",
    description: "Import, export, bulk-update and deduplicate records",
    icon: "stock",
    group: "Platform",
    permission: PERMISSIONS.dataManagementView,
  },
];

export default async function SettingsPage() {
  const session = await requireWorkspace();
  const allowedItems = items.filter((item) =>
    hasPermission(session, item.permission),
  );
  if (!allowedItems.length) notFound();

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Platform settings</p>
          <h1>Configure the ERP foundation</h1>
          <p>
            Maintain organisation structure, access controls and shared platform
            behaviour from one governed workspace.
          </p>
        </div>
        <span className="status-badge neutral">
          <AppIcon name="settings" size={14} /> Administration
        </span>
      </section>

      {(["Structure", "Access", "Controls", "Platform"] as const)
        .filter((group) => allowedItems.some((item) => item.group === group))
        .map((group) => (
        <section
          className="settings-section"
          key={group}
          aria-labelledby={`settings-${group.toLowerCase()}`}
        >
          <div className="section-title-row compact-heading">
            <div>
              <p className="eyebrow">{group}</p>
              <h2 id={`settings-${group.toLowerCase()}`}>
                {group === "Structure"
                  ? "Operating model"
                  : group === "Access"
                    ? "People and permissions"
                    : group === "Controls"
                      ? "Shared platform controls"
                      : "Automation, reporting, integrations and data"}
              </h2>
            </div>
          </div>
          <div className="settings-grid">
            {allowedItems
              .filter((item) => item.group === group)
              .map((item) => (
                <Link href={item.href} key={item.href}>
                  <span className="settings-card-icon" aria-hidden="true">
                    <AppIcon name={item.icon} size={22} />
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </div>
                  <AppIcon
                    className="settings-card-arrow"
                    name="arrow-right"
                    size={17}
                  />
                </Link>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

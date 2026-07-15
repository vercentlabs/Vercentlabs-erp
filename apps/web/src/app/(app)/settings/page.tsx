import Link from "next/link";

import AppIcon, { type AppIconName } from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";

export const metadata = { title: "Settings" };

const items: Array<{
  label: string;
  href: string;
  description: string;
  icon: AppIconName;
  group: "Structure" | "Access" | "Controls";
}> = [
  {
    label: "Organisation",
    href: "/settings/organization",
    description: "Workspace identity and operating defaults",
    icon: "organisation",
    group: "Structure",
  },
  {
    label: "Companies",
    href: "/settings/companies",
    description: "Legal entities and fiscal configuration",
    icon: "companies",
    group: "Structure",
  },
  {
    label: "Branches",
    href: "/settings/branches",
    description: "Operating locations and company assignment",
    icon: "branches",
    group: "Structure",
  },
  {
    label: "Departments",
    href: "/settings/departments",
    description: "Responsibility and reporting units",
    icon: "departments",
    group: "Structure",
  },
  {
    label: "Teams",
    href: "/settings/teams",
    description: "Cross-functional groups and ownership",
    icon: "teams",
    group: "Structure",
  },
  {
    label: "Cost centres",
    href: "/settings/cost-centres",
    description: "Cost accountability and reporting structure",
    icon: "cost-centres",
    group: "Structure",
  },
  {
    label: "Users",
    href: "/settings/users",
    description: "Invitations, status and operating access",
    icon: "users",
    group: "Access",
  },
  {
    label: "Roles & permissions",
    href: "/settings/roles",
    description: "Least-privilege roles and capabilities",
    icon: "roles",
    group: "Access",
  },
  {
    label: "Numbering series",
    href: "/settings/numbering-series",
    description: "Consistent identifiers for business records",
    icon: "numbering",
    group: "Controls",
  },
];

export default async function SettingsPage() {
  await requireWorkspace();

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

      {(["Structure", "Access", "Controls"] as const).map((group) => (
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
                    : "Shared platform controls"}
              </h2>
            </div>
          </div>
          <div className="settings-grid">
            {items
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

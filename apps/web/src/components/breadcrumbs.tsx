"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon from "@/components/app-icon";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  modules: "Modules",
  notifications: "Notifications",
  approvals: "Approvals",
  "audit-logs": "Audit logs",
  profile: "Profile",
  security: "Security",
  settings: "Settings",
  organization: "Organisation",
  companies: "Companies",
  branches: "Branches",
  departments: "Departments",
  teams: "Teams",
  "cost-centres": "Cost centres",
  users: "Users",
  roles: "Roles & permissions",
  "numbering-series": "Numbering series",
  search: "Search",
};

export default function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/dashboard" aria-label="Dashboard">
            <AppIcon name="dashboard" size={15} />
            <span>Workspace</span>
          </Link>
        </li>
        {parts.map((part, index) => {
          const href = `/${parts.slice(0, index + 1).join("/")}`;
          const last = index === parts.length - 1;
          const label = labels[part] || part.replaceAll("-", " ");

          if (part === "dashboard" && index === 0) return null;

          return (
            <li key={href}>
              <span className="breadcrumb-separator" aria-hidden="true">
                /
              </span>
              {last ? (
                <span aria-current="page">{label}</span>
              ) : (
                <Link href={href}>{label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon from "@/components/app-icon";

const labels: Record<string, string> = {
  dashboard: "Home",
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
  crm: "CRM",
  leads: "Leads",
  opportunities: "Opportunities",
  activities: "Activities",
  pipeline: "Pipeline",
  reports: "Reports",
  sales: "Sales",
  quotations: "Quotations",
  orders: "Orders",
  procurement: "Procurement",
  requisitions: "Requisitions",
  sourcing: "Sourcing",
  suppliers: "Suppliers",
  contracts: "Agreements",
  receipts: "Receipts",
  matching: "Matching",
  accounting: "Accounting",
  journals: "Journal entries",
  receivables: "Receivables",
  payables: "Payables",
  banking: "Banking",
  assets: "Fixed assets",
  planning: "Planning",
  tax: "Tax",
  operations: "Operations",
  close: "Period close",
  billing: "Billing",
  "master-data": "Master data",
  new: "New",
};

function titleFromSegment(segment: string) {
  if (labels[segment]) return labels[segment];
  if (/^[0-9a-f-]{24,}$/i.test(segment)) return "Record";
  return segment.replaceAll("-", " ");
}

export default function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/dashboard" aria-label="Home">
            <AppIcon name="dashboard" size={14} />
            <span>Home</span>
          </Link>
        </li>
        {parts.map((part, index) => {
          const href = `/${parts.slice(0, index + 1).join("/")}`;
          const last = index === parts.length - 1;
          const label = titleFromSegment(part);

          if (part === "dashboard" && index === 0) return null;

          return (
            <li key={href}>
              <span className="breadcrumb-separator" aria-hidden="true">
                <AppIcon name="chevron-down" size={12} />
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

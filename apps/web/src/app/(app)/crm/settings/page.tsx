import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon, { type AppIconName } from "@/shared/components/app-icon";
import { PageHeader, SectionHeader, StatusBadge } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";

export const metadata = { title: "CRM setup" };

type SetupItem = {
  label: string;
  href: string;
  description: string;
  icon: AppIconName;
  permission?: string;
};

type SetupGroup = {
  id: string;
  title: string;
  description: string;
  items: readonly SetupItem[];
};

const GROUPS: readonly SetupGroup[] = [
  {
    id: "lead-management",
    title: "Lead management",
    description: "Define capture attribution, qualification, routing and prioritization before sellers start working leads.",
    items: [
      { label: "Lead sources", href: "/crm/sources", description: "Define the source catalogue used on every lead.", icon: "import", permission: PERMISSIONS.crmSettingsManage },
      { label: "Lead lifecycle", href: "/crm/lead-lifecycle", description: "Order governed stages and allowed transitions.", icon: "audit", permission: PERMISSIONS.crmSettingsManage },
      { label: "Assignment rules", href: "/crm/assignment-rules", description: "Route new leads to the right owner or team.", icon: "teams", permission: PERMISSIONS.crmSettingsManage },
      { label: "Qualification criteria", href: "/crm/qualification-criteria", description: "Configure readiness checks used before qualification.", icon: "check", permission: PERMISSIONS.crmSettingsManage },
      { label: "Lead scoring", href: "/crm/lead-scoring", description: "Manage deterministic scoring, caps, decay and segments.", icon: "sparkles", permission: PERMISSIONS.crmSettingsManage },
      { label: "Duplicate detection rules", href: "/crm/duplicate-rules", description: "Configure matching signals used to flag possible duplicate records.", icon: "audit", permission: PERMISSIONS.crmSettingsManage },
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline",
    description: "Govern opportunity progression and the reasons used when revenue outcomes become terminal.",
    items: [
      { label: "Pipelines", href: "/crm/pipelines", description: "Maintain opportunity pipelines used by sales teams.", icon: "sales", permission: PERMISSIONS.crmSettingsManage },
      { label: "Sales stages", href: "/crm/stages", description: "Order stages, probabilities and won/lost terminal states.", icon: "modules", permission: PERMISSIONS.crmSettingsManage },
      { label: "Won / lost reasons", href: "/crm/lost-reasons", description: "Maintain governed outcome reasons captured when deals close.", icon: "check", permission: PERMISSIONS.crmSettingsManage },
    ],
  },
  {
    id: "organization",
    title: "Organization",
    description: "Configure CRM ownership, team membership, territory coverage and seller targets.",
    items: [
      { label: "Sales teams", href: "/crm/sales-teams", description: "Create sales teams and operating scope.", icon: "teams", permission: PERMISSIONS.crmRevenueManage },
      { label: "Team members", href: "/crm/sales-team-members", description: "Maintain membership and responsibility.", icon: "users", permission: PERMISSIONS.crmRevenueManage },
      { label: "Territories", href: "/crm/territories", description: "Define geographic or commercial territories.", icon: "branches", permission: PERMISSIONS.crmRevenueManage },
      { label: "Territory assignments", href: "/crm/territory-assignments", description: "Connect users and teams to territory ownership.", icon: "roles", permission: PERMISSIONS.crmRevenueManage },
      { label: "Quotas", href: "/crm/quota-plans", description: "Configure quota plans used by revenue operations and forecasting.", icon: "audit", permission: PERMISSIONS.crmRevenueManage },
    ],
  },
  {
    id: "data-customization",
    title: "Data & customization",
    description: "Control classification, custom schema and governed movement of CRM data.",
    items: [
      { label: "Data management", href: "/crm/data-management", description: "Import, export, deduplicate and customize from one workspace.", icon: "import" },
      { label: "Tags", href: "/crm/tags", description: "Maintain reusable record classification tags.", icon: "numbering", permission: PERMISSIONS.crmSettingsManage },
      { label: "Custom objects", href: "/crm/custom-object-definitions", description: "Define tenant-specific record types beyond standard CRM objects.", icon: "modules", permission: PERMISSIONS.crmSettingsManage },
      { label: "Custom fields", href: "/crm/custom-field-definitions", description: "Add typed, validated fields to custom objects.", icon: "settings", permission: PERMISSIONS.crmSettingsManage },
      { label: "Custom records", href: "/crm/custom-records", description: "Browse and manage custom-object records.", icon: "search", permission: PERMISSIONS.crmSettingsManage },
    ],
  },
  {
    id: "discoverability",
    title: "Discoverability",
    description: "Use the capability directory when you know what CRM should do but do not know which workspace owns it.",
    items: [
      { label: "All CRM features", href: "/crm/features", description: "Search every customer-facing CRM capability and its destination.", icon: "search" },
    ],
  },
];

export default async function CrmSettingsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(session, item.permission)),
  })).filter((group) => group.items.length > 0);

  const canManage = [PERMISSIONS.crmSettingsManage, PERMISSIONS.crmRevenueManage, PERMISSIONS.crmAutomationManage]
    .some((permission) => hasPermission(session, permission));

  return (
    <div className="crm-setup-page">
      <PageHeader
        eyebrow="CRM · Administration"
        title="CRM setup"
        description="Configure lead management, pipeline governance, ownership, data quality and customization without hunting through unrelated screens."
        context={<StatusBadge tone="neutral">{canManage ? "Manage setup" : "Read only"}</StatusBadge>}
      />

      <nav className="crm-setup-groups" aria-label="CRM setup areas">
        {visibleGroups.map((group) => (
          <section className="crm-setup-group" id={group.id} key={group.id} aria-labelledby={`crm-setup-${group.id}`}>
            <SectionHeader headingId={`crm-setup-${group.id}`} title={group.title} description={group.description} />
            <div className="crm-setup-grid">
              {group.items.map((item) => (
                <Link href={item.href} key={item.href}>
                  <span className="crm-setup-card__icon" aria-hidden="true"><AppIcon name={item.icon} size={20} /></span>
                  <span className="crm-setup-card__copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                  <AppIcon name="arrow-right" size={16} />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>
    </div>
  );
}

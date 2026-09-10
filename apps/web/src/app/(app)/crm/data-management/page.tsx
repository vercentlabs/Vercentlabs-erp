import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { PageHeader, SectionHeader, StatusBadge } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";

export const metadata = { title: "CRM data management" };

const GROUPS = [
  {
    title: "Move data",
    description: "Bring information into CRM or take an explicitly scoped copy out.",
    items: [
      ["Lead import", "/crm/leads", "Use the Leads workspace Import CSV action with duplicate detection and row validation.", "import"],
      ["Lead export", "/crm/leads", "Use the Leads workspace export action so the current permitted view and filter scope stay visible.", "audit"],
    ],
  },
  {
    title: "Data quality",
    description: "Prevent duplicate records and resolve suspicious matches before they damage reporting.",
    items: [
      ["Duplicate rules", "/crm/duplicate-rules", "Configure matching signals and review policy for Leads, Accounts and Contacts.", "audit"],
      ["Lead review", "/crm/leads", "Open duplicate warnings, merge tools and data-quality signals in Lead 360.", "crm"],
    ],
  },
  {
    title: "Classification & customization",
    description: "Extend the CRM without scattering one-off fields and labels through individual screens.",
    items: [
      ["Tags", "/crm/tags", "Manage reusable classification tags.", "numbering"],
      ["Custom objects", "/crm/custom-object-definitions", "Define tenant-specific CRM record types.", "modules"],
      ["Custom fields", "/crm/custom-field-definitions", "Create typed fields with validation and access rules.", "settings"],
      ["Custom records", "/crm/custom-records", "Browse records stored for custom object definitions.", "search"],
    ],
  },
] as const;

export default async function CrmDataManagementPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const canManage = hasPermission(session, PERMISSIONS.crmSettingsManage) || hasPermission(session, PERMISSIONS.crmLeadsManage);

  return (
    <div className="crm-data-management-page">
      <PageHeader
        eyebrow="CRM · Data"
        title="Data management"
        description="Import, export, deduplicate and customize CRM data from one discoverable workspace."
        context={<StatusBadge tone="neutral">{canManage ? "Manage data" : "Read only"}</StatusBadge>}
      />
      <div className="crm-data-management-groups">
        {GROUPS.map((group) => (
          <section className="crm-data-management-group" key={group.title}>
            <SectionHeader title={group.title} description={group.description} />
            <div className="crm-data-management-grid">
              {group.items.map(([label, href, description, icon]) => (
                <Link href={href} className="crm-data-management-card" key={label}>
                  <span aria-hidden="true"><AppIcon name={icon} size={19} /></span>
                  <span><strong>{label}</strong><small>{description}</small></span>
                  <AppIcon name="arrow-right" size={16} />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

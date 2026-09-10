import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon, { type AppIconName } from "@/shared/components/app-icon";
import { PageHeader, SectionHeader, StatusBadge } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { canViewCrmResource } from "@/modules/crm/api";
import type { CrmResourceKey } from "@vercentlabs/shared-types";

export const metadata = { title: "CRM setup" };

const groups = [
  {
    title: "Lead management",
    description: "Control where leads come from, who receives them and how scoring supports qualification.",
    items: [
      ["Lead sources", "sources", "Define the source catalogue used on every lead.", "import"],
      ["Lead lifecycle", "lead-lifecycle", "Order the governed working stages used by Leads and Kanban.", "audit"],
      ["Assignment rules", "assignment-rules", "Route new leads to the right owner or team.", "teams"],
      ["Lead scoring", "lead-scoring", "Manage the deterministic scoring model, rules, caps, decay and segmentation.", "sparkles"],
      ["Qualification criteria", "qualification-criteria", "Configure the readiness checklist required before a lead can be marked qualified.", "check"],
    ],
  },
  {
    title: "Pipeline",
    description: "Configure the sales process without creating parallel revenue-operations workspaces.",
    items: [
      ["Pipelines", "pipelines", "Maintain the opportunity pipeline used by the sales team.", "sales"],
      ["Sales stages", "stages", "Order stages, probabilities and won/lost terminal states.", "modules"],
      ["Won / lost reasons", "lost-reasons", "Maintain governed outcome reasons captured when deals close.", "check"],
    ],
  },
  {
    title: "Teams & territories",
    description: "Define ownership structures used by CRM assignment and reporting.",
    items: [
      ["Sales teams", "sales-teams", "Create sales teams and their operating scope.", "teams"],
      ["Team members", "sales-team-members", "Maintain team membership and responsibility.", "users"],
      ["Territories", "territories", "Define geographic or commercial territories.", "branches"],
      ["Territory assignments", "territory-assignments", "Connect users and teams to territories.", "roles"],
    ],
  },
  {
    title: "Customization",
    description: "Keep the CRM language flexible without introducing custom-object complexity beyond the standard CRM record types.",
    items: [
      ["Tags", "tags", "Maintain reusable tags for fast lead classification.", "numbering"],
      ["Custom objects", "custom-object-definitions", "Define tenant-specific record types beyond the standard CRM set.", "modules"],
      ["Custom fields", "custom-field-definitions", "Add typed, validated, optionally role-restricted fields to a custom object.", "settings"],
      ["Custom records", "custom-records", "Browse and manage records stored against a custom object definition.", "search"],
    ],
  },
  {
    title: "Data quality",
    description: "Govern how the CRM detects and resolves duplicate Leads, Accounts and Contacts.",
    items: [
      ["Duplicate detection rules", "duplicate-rules", "Enable, reweight or disable the signals used to flag possible duplicate records.", "audit"],
    ],
  },
] as const satisfies ReadonlyArray<{
  title: string;
  description: string;
  items: ReadonlyArray<readonly [string, CrmResourceKey | "lead-lifecycle" | "lead-scoring" | "duplicate-rules", string, AppIconName]>;
}>;

export default async function CrmSettingsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(([, key]) =>
        key === "lead-lifecycle" || key === "lead-scoring" || key === "duplicate-rules"
          ? hasPermission(session, PERMISSIONS.crmSettingsManage)
          : canViewCrmResource(session, key),
      ),
    }))
    .filter((group) => group.items.length);

  if (!visibleGroups.length) notFound();

  const canManage = [
    PERMISSIONS.crmSettingsManage,
    PERMISSIONS.crmAutomationManage,
  ].some((permission) => hasPermission(session, permission));

  return (
    <div className="crm-setup-page">
      <PageHeader
        eyebrow="CRM · Configuration"
        title="CRM setup"
        description="Configure lead management, pipeline, teams, territories and lightweight customization for your CRM."
        context={<StatusBadge tone="neutral">{canManage ? "Manage setup" : "Read only"}</StatusBadge>}
      />

      <div className="crm-setup-groups">
        {visibleGroups.map((group) => (
          <section className="crm-setup-group" key={group.title}>
            <SectionHeader
              eyebrow="Configuration"
              title={group.title}
              description={group.description}
            />
            <div className="crm-setup-grid">
              {group.items.map(([label, key, description, icon]) => (
                <Link href={`/crm/${key}`} key={key}>
                  <span className="crm-setup-card__icon" aria-hidden="true">
                    <AppIcon name={icon} size={20} />
                  </span>
                  <span className="crm-setup-card__copy">
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
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

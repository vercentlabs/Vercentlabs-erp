import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
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
      ["Lead sources", "sources", "Define the source catalogue used on every lead."],
      ["Lead lifecycle", "lead-lifecycle", "Order the governed working stages used by Leads and Kanban."],
      ["Assignment rules", "assignment-rules", "Route new leads to the right owner or team."],
      ["Lead scoring", "scoring-rules", "Create explainable rules that contribute to the lead score."],
    ],
  },
  {
    title: "Pipeline",
    description: "Configure the sales process without creating parallel revenue-operations workspaces.",
    items: [
      ["Pipelines", "pipelines", "Maintain the opportunity pipeline used by the sales team."],
      ["Sales stages", "stages", "Order stages, probabilities and won/lost terminal states."],
      ["Won / lost reasons", "lost-reasons", "Maintain governed outcome reasons captured when deals close."],
    ],
  },
  {
    title: "Teams & territories",
    description: "Define ownership structures used by CRM assignment and reporting.",
    items: [
      ["Sales teams", "sales-teams", "Create sales teams and their operating scope."],
      ["Team members", "sales-team-members", "Maintain team membership and responsibility."],
      ["Territories", "territories", "Define geographic or commercial territories."],
      ["Territory assignments", "territory-assignments", "Connect users and teams to territories."],
    ],
  },
  {
    title: "Customization",
    description: "Keep the CRM language flexible without introducing custom-object complexity outside F001–F030.",
    items: [
      ["Tags", "tags", "Maintain reusable tags for fast lead classification."],
    ],
  },
] as const satisfies ReadonlyArray<{
  title: string;
  description: string;
  items: ReadonlyArray<readonly [string, CrmResourceKey | "lead-lifecycle", string]>;
}>;

export default async function CrmSettingsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(([, key]) =>
        key === "lead-lifecycle"
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
      <section className="page-heading crm-hci-heading">
        <div>
          <p className="eyebrow">CRM · Configuration</p>
          <h1>CRM setup</h1>
          <p>
            Configure only the controls used by the canonical thirty-feature CRM: lead management, pipeline, teams, territories and lightweight customization.
          </p>
        </div>
        <span className="status-badge neutral">{canManage ? "Manage setup" : "Read only"}</span>
      </section>

      <div className="crm-setup-groups">
        {visibleGroups.map((group) => (
          <section className="crm-setup-group" key={group.title}>
            <div className="crm-setup-group__heading">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2>{group.title}</h2>
                <p>{group.description}</p>
              </div>
            </div>
            <div className="crm-setup-grid">
              {group.items.map(([label, key, description]) => (
                <Link href={`/crm/${key}`} key={key}>
                  <span className="crm-setup-card__icon" aria-hidden="true">
                    <AppIcon name="crm" size={20} />
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

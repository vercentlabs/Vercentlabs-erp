import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { canViewCrmResource } from "@/lib/crm-api";
import type { CrmResourceKey } from "@vercent/shared-types";
export const metadata = { title: "CRM settings" };
const groups = {
  "Pipeline and classification": [
    ["Pipelines", "pipelines"],
    ["Pipeline stages", "stages"],
    ["Lead sources", "sources"],
    ["Lost reasons", "lost-reasons"],
    ["Tags", "tags"],
    ["Competitors", "competitors"],
  ],
  "Automation and capture": [
    ["Lead scoring rules", "scoring-rules"],
    ["Assignment rules", "assignment-rules"],
    ["Follow-up sequences", "sequences"],
    ["Sequence steps", "sequence-steps"],
    ["Sequence enrollments", "sequence-enrollments"],
    ["Automation rules", "automation-rules"],
    ["Lead capture forms", "capture-forms"],
  ],
  "Revenue operations": [
    ["Sales teams", "sales-teams"],
    ["Sales team members", "sales-team-members"],
    ["Territories", "territories"],
    ["Territory assignments", "territory-assignments"],
    ["Quota plans", "quota-plans"],
    ["Forecast periods", "forecast-periods"],
    ["Forecast submissions", "forecast-submissions"],
    ["Forecast targets", "forecast-targets"],
  ],
  "Account strategy and guided selling": [
    ["Account plans", "account-plans"],
    ["Account stakeholders", "account-stakeholders"],
    ["Sales playbooks", "playbooks"],
    ["Playbook questions", "playbook-questions"],
    ["Playbook responses", "playbook-responses"],
  ],
  "Privacy and data quality": [
    ["Consent evidence", "consent-events"],
    ["Privacy requests", "privacy-requests"],
    ["Data quality scores", "data-quality-scores"],
  ],
  "Unified engagement": [
    ["Engagement templates", "engagement-templates"],
    ["Meeting links", "meeting-links"],
    ["Email and calendar accounts", "sync-accounts"],
    ["Customer conversations", "conversations"],
    ["Conversation insights", "conversation-insights"],
  ],
  "Revenue and relationship intelligence": [
    ["Pipeline inspections", "pipeline-inspections"],
    ["Deal risks", "deal-risks"],
    ["Seller recommendations", "recommendations"],
    ["Buying committees", "buying-committees"],
    ["Buying committee members", "buying-committee-members"],
    ["Relationship map", "relationship-edges"],
    ["Account signals", "account-signals"],
  ],
  "Partner and field selling": [
    ["Partner accounts", "partner-accounts"],
    ["Partner deals", "partner-deals"],
    ["Field visits", "field-visits"],
  ],
  "Analytics and customization": [
    ["Report definitions", "report-definitions"],
    ["Dashboards", "dashboards"],
    ["Dashboard widgets", "dashboard-widgets"],
    ["Custom object definitions", "custom-object-definitions"],
    ["Custom field definitions", "custom-field-definitions"],
    ["Custom records", "custom-records"],
  ],
  "Data enrichment and governed AI": [
    ["Enrichment jobs", "enrichment-jobs"],
    ["AI predictions", "ai-predictions"],
    ["AI feedback", "ai-feedback"],
  ],
  "Integrations and personalisation": [
    ["Communication integrations", "integrations"],
    ["Webhook subscriptions", "webhook-subscriptions"],
    ["Saved views", "saved-views"],
  ],
} satisfies Record<string, ReadonlyArray<readonly [string, CrmResourceKey]>>;
export default async function CrmSettingsPage() {
  const session = await requireWorkspace();
  const visibleGroups = Object.entries(groups)
    .map(
      ([group, items]) =>
        [
          group,
          items.filter(([, key]) => canViewCrmResource(session, key)),
        ] as const,
    )
    .filter(([, items]) => items.length);
  if (!visibleGroups.length) notFound();

  const canManage = [
    PERMISSIONS.crmSettingsManage,
    PERMISSIONS.crmAutomationManage,
    PERMISSIONS.crmRevenueManage,
    PERMISSIONS.crmAccountsManage,
    PERMISSIONS.crmPlaybooksManage,
    PERMISSIONS.crmPrivacyManage,
    PERMISSIONS.crmDataQualityManage,
    PERMISSIONS.crmIntegrationsManage,
    PERMISSIONS.crmAnalyticsManage,
    PERMISSIONS.crmCustomizationManage,
    PERMISSIONS.crmPartnersManage,
    PERMISSIONS.crmFieldSalesManage,
  ].some((permission) => hasPermission(session, permission));
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM administration</p>
          <h1>Configure the customer lifecycle</h1>
          <p>
            Govern stages, engagement, intelligence, partner selling, analytics,
            customization, privacy, data quality and provider-neutral
            integrations.
          </p>
        </div>
        <span className="status-badge neutral">
          {canManage ? "Manage settings" : "Read only"}
        </span>
      </section>
      {visibleGroups.map(([group, visibleItems]) => {
        return (
          <section className="settings-section" key={group}>
            <div className="section-title-row compact-heading">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2>{group}</h2>
              </div>
            </div>
            <div className="settings-grid">
              {visibleItems.map(([label, key]) => (
                <Link href={`/crm/${key}`} key={key}>
                  <span className="settings-card-icon">
                    <AppIcon name="crm" size={22} />
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <span>Open governed {label.toLowerCase()}</span>
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
        );
      })}
    </>
  );
}

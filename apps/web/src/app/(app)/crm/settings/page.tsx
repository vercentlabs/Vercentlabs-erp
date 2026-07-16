import Link from "next/link";
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
  "Integrations and personalisation": [
    ["Communication integrations", "integrations"],
    ["Webhook subscriptions", "webhook-subscriptions"],
    ["Saved views", "saved-views"],
  ],
} satisfies Record<string, ReadonlyArray<readonly [string, CrmResourceKey]>>;
export default async function CrmSettingsPage() {
  const session = await requireWorkspace();
  const canManage = [
    PERMISSIONS.crmSettingsManage,
    PERMISSIONS.crmAutomationManage,
    PERMISSIONS.crmRevenueManage,
    PERMISSIONS.crmAccountsManage,
    PERMISSIONS.crmPlaybooksManage,
    PERMISSIONS.crmPrivacyManage,
    PERMISSIONS.crmDataQualityManage,
    PERMISSIONS.crmIntegrationsManage,
  ].some((permission) => hasPermission(session, permission));
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM administration</p>
          <h1>Configure the customer lifecycle</h1>
          <p>
            Govern stages, scoring, territories, quotas, forecasting, account
            plans, privacy, data quality and provider-neutral integrations.
          </p>
        </div>
        <span className="status-badge neutral">
          {canManage ? "Manage settings" : "Read only"}
        </span>
      </section>
      {Object.entries(groups).map(([group, items]) => {
        const visibleItems = items.filter(([, key]) =>
          canViewCrmResource(session, key),
        );
        if (!visibleItems.length) return null;
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

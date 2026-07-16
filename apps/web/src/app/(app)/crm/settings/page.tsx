import Link from "next/link";
import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
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
  "Forecast and integrations": [
    ["Forecast targets", "forecast-targets"],
    ["Communication integrations", "integrations"],
    ["Webhook subscriptions", "webhook-subscriptions"],
    ["Saved views", "saved-views"],
  ],
} as const;
export default async function CrmSettingsPage() {
  const session = await requireWorkspace();
  const canManage =
    hasPermission(session, PERMISSIONS.crmSettingsManage) ||
    hasPermission(session, PERMISSIONS.crmAutomationManage);
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM administration</p>
          <h1>Configure the customer lifecycle</h1>
          <p>
            Govern stages, scoring, assignment, capture, follow-up automation,
            targets and provider-neutral integration boundaries.
          </p>
        </div>
        <span className="status-badge neutral">
          {canManage ? "Manage settings" : "Read only"}
        </span>
      </section>
      {Object.entries(groups).map(([group, items]) => (
        <section className="settings-section" key={group}>
          <div className="section-title-row compact-heading">
            <div>
              <p className="eyebrow">Configuration</p>
              <h2>{group}</h2>
            </div>
          </div>
          <div className="settings-grid">
            {items.map(([label, key]) => (
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
      ))}
    </>
  );
}

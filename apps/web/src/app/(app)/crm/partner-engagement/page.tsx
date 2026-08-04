import {
  getCrmPartnerEngagementReadiness,
  getPartnerEngagementDashboard,
} from "@vercentlabs/api";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function PartnerEngagementPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return null;
  const context = crmContext(session);
  const { dashboard, readiness } = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getPartnerEngagementDashboard(client, context),
      readiness: await getCrmPartnerEngagementReadiness(client, context),
    }),
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-10 · Partner & engagement</p>
          <h1>Partner, field sales and seller engagement</h1>
          <p>
            Govern deal registration, MDF, field visits, branching sequences,
            coaching and gamification.
          </p>
        </div>
        <span
          className={`status-badge ${readiness.readiness === "ready" ? "success" : "neutral"}`}
        >
          {String(readiness.readiness)} · {String(readiness.passed)}/
          {String(readiness.total)}
        </span>
      </section>
      <div className="crm-dashboard-grid">
        {Object.entries(dashboard).map(([label, value]) => (
          <section className="panel" key={label}>
            <p className="eyebrow">{label.replaceAll("_", " ")}</p>
            <h2>{String(value)}</h2>
          </section>
        ))}
      </div>
    </>
  );
}

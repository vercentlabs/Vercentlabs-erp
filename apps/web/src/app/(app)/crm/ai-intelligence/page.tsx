import { getCrmAiDashboard, getCrmAiReadiness } from "@vercentlabs/api";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function AiPage() {
  const s = await requireWorkspace();
  if (!hasPermission(s, PERMISSIONS.crmView)) return null;
  const c = crmContext(s);
  const { dashboard, readiness } = await tenantTransaction(
    c.organizationId,
    async (client) => ({
      dashboard: await getCrmAiDashboard(client, c),
      readiness: await getCrmAiReadiness(client, c),
    }),
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-11 · Governed AI</p>
          <h1>Recommendations, relationships and assistants</h1>
          <p>
            Explainable CRM intelligence with human approval and feedback
            learning.
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
        {Object.entries(dashboard).map(([k, v]) => (
          <section className="panel" key={k}>
            <p className="eyebrow">{k.replaceAll("_", " ")}</p>
            <h2>{String(v)}</h2>
          </section>
        ))}
      </div>
    </>
  );
}

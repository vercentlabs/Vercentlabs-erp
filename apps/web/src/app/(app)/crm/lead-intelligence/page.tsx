import {
  getCrmLeadIntelligenceReadiness,
  getLeadIntelligenceDashboard,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
export default async function LeadIntelligencePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getLeadIntelligenceDashboard(client, context),
        getCrmLeadIntelligenceReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const grades = (dashboard.grades || []) as Row[];
  const sla = (dashboard.sla || []) as Row[];
  const queue = (dashboard.topQueue || []) as Row[];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-08 lead intelligence</p>
          <h1>Scores, response SLAs and seller nurture</h1>
          <p>
            Explain every lead score, enforce first-response commitments,
            escalate breaches and prioritize the next best seller action without
            bypassing consent.
          </p>
        </div>
        <span
          className={`status-badge ${readiness.readiness === "ready" ? "success" : "danger"}`}
        >
          {String(readiness.readiness)} · {String(readiness.score)}%
        </span>
      </section>
      <section className="module-stat-grid">
        {[
          ["Active leads", summary.active_leads || 0],
          ["Qualified", summary.qualified_leads || 0],
          ["Average score", summary.average_score || 0],
          ["Unscored", summary.unscored_leads || 0],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Score distribution</h2>
        <div className="crm-stage-summary">
          {grades.map((row) => (
            <div key={String(row.lead_grade)}>
              <span>
                <strong>{String(row.lead_grade)}</strong>
                <small>Versioned behavioural and firmographic scoring</small>
              </span>
              <b>{String(row.leads)}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Response SLA</h2>
        <div className="crm-stage-summary">
          {sla.map((row) => (
            <div key={String(row.status)}>
              <span>
                <strong>{String(row.status)}</strong>
                <small>First-response cases</small>
              </span>
              <b>{String(row.cases)}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Prioritized nurture queue</h2>
        <div className="crm-stage-summary">
          {queue.length ? (
            queue.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.full_name)}</strong>
                  <small>
                    {String(row.company_name || "No company")} · score{" "}
                    {String(row.score)} · {String(row.recommended_action)}
                  </small>
                </span>
                <b>{String(row.priority_score)}</b>
              </div>
            ))
          ) : (
            <p>No nurture items are currently due.</p>
          )}
        </div>
      </section>
    </>
  );
}

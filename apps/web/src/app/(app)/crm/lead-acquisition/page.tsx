import Link from "next/link";
import {
  getCrmLeadAcquisitionReadiness,
  getLeadAcquisitionDashboard,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function LeadAcquisitionPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getLeadAcquisitionDashboard(client, context),
        getCrmLeadAcquisitionReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const imports = (dashboard.imports || []) as Row[];
  const forms = (dashboard.forms || []) as Row[];
  const connections = (dashboard.connections || []) as Row[];
  const enrichment = (dashboard.enrichment || []) as Row[];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-06 lead acquisition</p>
          <h1>Capture, import and enrich leads</h1>
          <p>
            Build governed forms, validate bulk imports, connect advertising and
            social channels, capture website conversations and review enriched
            company intelligence before it changes customer data.
          </p>
        </div>
        <span
          className={`status-badge ${
            readiness.readiness === "ready" ? "success" : "danger"
          }`}
        >
          {String(readiness.readiness)} · {String(readiness.score)}%
        </span>
      </section>
      <section className="module-stat-grid">
        {[
          ["Imports", summary.imports ?? 0],
          ["Published forms", summary.published_forms ?? 0],
          ["Connected channels", summary.active_connections ?? 0],
          ["Pending enrichment", summary.pending_enrichment ?? 0],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>
      <section
        className="module-hero-actions"
        aria-label="Lead acquisition navigation"
      >
        <Link className="secondary-button" href="/crm/capture-forms">
          Capture forms
        </Link>
        <Link className="secondary-button" href="/crm/enrichment-jobs">
          Enrichment jobs
        </Link>
        <Link className="secondary-button" href="/crm/leads">
          Leads
        </Link>
        <Link className="secondary-button" href="/crm/readiness">
          CRM readiness
        </Link>
      </section>
      <section className="panel">
        <h2>Recent imports</h2>
        <div className="crm-stage-summary">
          {imports.length ? (
            imports.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.file_name)}</strong>
                  <small>
                    {String(row.valid_rows)} valid · {String(row.invalid_rows)}{" "}
                    invalid
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))
          ) : (
            <p>No lead imports have been previewed.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Published forms and channels</h2>
        <div className="crm-stage-summary">
          {[...forms, ...connections].length ? (
            [...forms, ...connections].map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.name || row.display_name)}</strong>
                  <small>
                    {String(row.provider || `version ${row.version || 1}`)}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))
          ) : (
            <p>No forms or acquisition channels are configured.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Enrichment review queue</h2>
        <div className="crm-stage-summary">
          {enrichment.length ? (
            enrichment.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.provider)}</strong>
                  <small>
                    {String(row.entity_type)} · confidence{" "}
                    {String(row.confidence ?? "—")}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))
          ) : (
            <p>No enrichment proposals require review.</p>
          )}
        </div>
      </section>
    </>
  );
}

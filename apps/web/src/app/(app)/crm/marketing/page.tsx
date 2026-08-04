import Link from "next/link";
import {
  getCrmMarketingReadiness,
  getMarketingDashboard,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function MarketingPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getMarketingDashboard(client, context),
        getCrmMarketingReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const campaigns = (dashboard.campaigns || []) as Row[];
  const segments = (dashboard.segments || []) as Row[];
  const journeys = (dashboard.journeys || []) as Row[];
  const events = (dashboard.events || []) as Row[];
  const surveys = (dashboard.surveys || []) as Row[];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-07 marketing execution</p>
          <h1>Segments, journeys and attributable growth</h1>
          <p>
            Build consent-aware audiences, execute email and SMS campaigns,
            automate journeys, test variants, manage events and surveys, and
            connect every response to governed marketing attribution.
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
          ["Active segments", summary.active_segments ?? 0],
          ["Active journeys", summary.active_enrollments ?? 0],
          ["Delivered", summary.delivered ?? 0],
          ["Survey responses", summary.survey_responses ?? 0],
          ["Registrations", summary.registrations ?? 0],
          ["Influenced revenue", summary.influenced_revenue ?? 0],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>

      <section
        className="module-hero-actions"
        aria-label="Marketing navigation"
      >
        <Link className="secondary-button" href="/crm/campaigns">
          Campaign records
        </Link>
        <Link className="secondary-button" href="/crm/communications">
          Communications
        </Link>
        <Link className="secondary-button" href="/crm/lead-acquisition">
          Lead acquisition
        </Link>
        <Link className="secondary-button" href="/crm/reports">
          CRM reports
        </Link>
      </section>

      <section className="panel">
        <h2>Campaign execution</h2>
        <div className="crm-stage-summary">
          {campaigns.length ? (
            campaigns.map((campaign) => (
              <div key={String(campaign.id)}>
                <span>
                  <strong>{String(campaign.name)}</strong>
                  <small>
                    {String(campaign.runs || 0)} runs ·{" "}
                    {String(campaign.sent || 0)} sent ·{" "}
                    {String(campaign.responses || 0)} responses
                  </small>
                </span>
                <b>{String(campaign.status)}</b>
              </div>
            ))
          ) : (
            <p>No governed campaign runs have been created.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Audience segments</h2>
        <div className="crm-stage-summary">
          {segments.length ? (
            segments.map((segment) => (
              <div key={String(segment.id)}>
                <span>
                  <strong>{String(segment.name)}</strong>
                  <small>
                    {String(segment.subject_type)} ·{" "}
                    {String(segment.segment_type)} ·{" "}
                    {String(segment.member_count || 0)} members
                  </small>
                </span>
                <b>{String(segment.refresh_status)}</b>
              </div>
            ))
          ) : (
            <p>No reusable marketing segments exist.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Journeys, events and surveys</h2>
        <div className="crm-stage-summary">
          {[...journeys, ...events, ...surveys].length ? (
            [...journeys, ...events, ...surveys].map((record) => (
              <div key={String(record.id)}>
                <span>
                  <strong>{String(record.name)}</strong>
                  <small>
                    {record.enrollments !== undefined
                      ? `${String(record.enrollments)} enrolments`
                      : record.registrations !== undefined
                        ? `${String(record.registrations)} registrations`
                        : `${String(record.responses || 0)} responses`}
                  </small>
                </span>
                <b>{String(record.status)}</b>
              </div>
            ))
          ) : (
            <p>No journeys, events or surveys are configured.</p>
          )}
        </div>
      </section>
    </>
  );
}

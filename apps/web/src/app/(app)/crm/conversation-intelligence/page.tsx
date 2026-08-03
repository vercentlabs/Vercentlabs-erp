import Link from "next/link";
import {
  getConversationIntelligenceDashboard,
  getCrmConversationReadiness,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function ConversationIntelligencePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getConversationIntelligenceDashboard(client, context),
        getCrmConversationReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const connections = (dashboard.connections || []) as Row[];
  const jobs = (dashboard.jobs || []) as Row[];
  const recent = (dashboard.recent || []) as Row[];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-05 conversation intelligence</p>
          <h1>Calls, recordings and transcripts</h1>
          <p>
            Start governed calls, process verified provider events, enforce
            recording consent, review transcripts and convert customer
            conversations into accountable actions.
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
          ["Calls · 30 days", summary.calls_30d ?? 0],
          ["Active calls", summary.active_calls ?? 0],
          ["Recordings", summary.recordings_available ?? 0],
          ["Transcripts ready", summary.transcripts_ready ?? 0],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>
      <section
        className="module-hero-actions"
        aria-label="Conversation intelligence navigation"
      >
        <Link className="secondary-button" href="/crm/conversations">
          Conversation records
        </Link>
        <Link className="secondary-button" href="/crm/conversation-insights">
          Review insights
        </Link>
        <Link className="secondary-button" href="/crm/communications">
          Communications
        </Link>
        <Link className="secondary-button" href="/crm/readiness">
          CRM readiness
        </Link>
      </section>
      <section className="panel">
        <h2>Telephony providers</h2>
        <div className="crm-stage-summary">
          {connections.length ? (
            connections.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>
                    {String(row.provider)} · recording{" "}
                    {String(row.recording_enabled)} · transcription{" "}
                    {String(row.transcription_enabled)}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))
          ) : (
            <p>No telephony provider is configured.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Recent calls and meetings</h2>
        <div className="crm-stage-summary">
          {recent.length ? (
            recent.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.title || "Untitled conversation")}
                  </strong>
                  <small>
                    {String(row.direction || row.channel)} ·{" "}
                    {String(row.from_number || "—")} →{" "}
                    {String(row.to_number || "—")}
                  </small>
                </span>
                <b>{String(row.transcript_status)}</b>
              </div>
            ))
          ) : (
            <p>No governed calls or meetings yet.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Transcription queue</h2>
        <div className="crm-stage-summary">
          {jobs.length ? (
            jobs.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.provider)}</strong>
                  <small>
                    Created {String(row.created_at)} · attempts{" "}
                    {String(row.attempts)}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))
          ) : (
            <p>No transcription jobs are pending.</p>
          )}
        </div>
      </section>
    </>
  );
}

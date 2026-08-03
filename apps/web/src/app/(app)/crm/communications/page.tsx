import Link from "next/link";
import {
  getCommunicationsDashboard,
  getCrmCommunicationsReadiness,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function CrmCommunicationsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getCommunicationsDashboard(client, context),
        getCrmCommunicationsReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const inboxes = (dashboard.inboxes || []) as Row[];
  const threads = (dashboard.threads || []) as Row[];
  const meetings = (dashboard.upcomingMeetings || []) as Row[];
  const accounts = (dashboard.syncAccounts || []) as Row[];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-04 communications</p>
          <h1>Inbox, email and calendar</h1>
          <p>
            Coordinate shared conversations, provider synchronisation,
            engagement events, deliverability controls and self-service meeting
            bookings from one tenant-governed workspace.
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
          ["Open threads", summary.open_threads ?? 0],
          ["Unread", summary.unread_threads ?? 0],
          ["Overdue SLA", summary.overdue_threads ?? 0],
          ["Suppressed", summary.active_suppressions ?? 0],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>
      <section
        className="module-hero-actions"
        aria-label="Communication navigation"
      >
        <Link className="secondary-button" href="/crm/sync-accounts">
          Sync accounts
        </Link>
        <Link className="secondary-button" href="/crm/meeting-links">
          Meeting links
        </Link>
        <Link className="secondary-button" href="/crm/engagement-templates">
          Templates
        </Link>
        <Link className="secondary-button" href="/crm/readiness">
          CRM readiness
        </Link>
      </section>
      <section className="panel">
        <h2>Shared inboxes</h2>
        <div className="crm-stage-summary">
          {inboxes.length ? (
            inboxes.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.name)}</strong>
                  <small>
                    {String(row.address || row.channel)} · SLA{" "}
                    {String(row.sla_minutes)} min
                  </small>
                </span>
                <b>{String(row.open_threads)} open</b>
              </div>
            ))
          ) : (
            <p>No shared inbox is configured.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Conversation queue</h2>
        <div className="crm-stage-summary">
          {threads.length ? (
            threads.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.subject || "Untitled conversation")}
                  </strong>
                  <small>
                    {String(row.inbox_name || row.provider)} ·{" "}
                    {String(row.last_message_at)}
                  </small>
                </span>
                <b>{String(row.priority)}</b>
              </div>
            ))
          ) : (
            <p>No open conversations.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Provider health</h2>
        <div className="crm-stage-summary">
          {accounts.length ? (
            accounts.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>
                    {String(row.provider)} · last sync{" "}
                    {String(row.last_synced_at || "never")}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))
          ) : (
            <p>No provider account is connected.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Upcoming meetings</h2>
        <div className="crm-stage-summary">
          {meetings.length ? (
            meetings.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.meeting_name)}</strong>
                  <small>
                    {String(row.guest_name)} · {String(row.guest_email)}
                  </small>
                </span>
                <b>{String(row.starts_at)}</b>
              </div>
            ))
          ) : (
            <p>No upcoming self-service meetings.</p>
          )}
        </div>
      </section>
    </>
  );
}

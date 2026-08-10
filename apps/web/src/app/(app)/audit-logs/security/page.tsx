import Link from "next/link";
import { notFound } from "next/navigation";

import AuditEventTable, { type AuditEventDisplayRow } from "@/components/audit-event-table";
import GovernancePagination from "@/components/governance-pagination";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { redactAuditPayload } from "@/lib/audit/redact";
import { listLoginEvents, listSecurityAuditEvents } from "@/lib/audit/query";

export const metadata = { title: "Security events" };
export const dynamic = "force-dynamic";

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function SecurityEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ eventsPage?: string; loginsPage?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.auditView)) notFound();

  const params = await searchParams;
  const eventsPage = Number(params.eventsPage || 1);
  const loginsPage = Number(params.loginsPage || 1);
  const organizationId = session.organizationId as string;

  const [events, logins] = await Promise.all([
    listSecurityAuditEvents(organizationId, { page: eventsPage, pageSize: 50 }),
    listLoginEvents(organizationId, { page: loginsPage, pageSize: 50 }),
  ]);

  const displayRows: AuditEventDisplayRow[] = events.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    ipAddress: row.ip_address,
    createdAt: row.created_at.toISOString(),
    metadata: redactAuditPayload(row.metadata),
    beforeData: redactAuditPayload(row.before_data),
    afterData: redactAuditPayload(row.after_data),
  }));

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Audit logs</p>
          <h1>Security events</h1>
          <p>
            Authentication, access and module-enablement changes, plus
            sign-in attempts for workspace members. Only events this
            workspace actually captures — no fabricated threat data.
          </p>
        </div>
      </section>

      <nav className="tab-strip" aria-label="Audit log views">
        <Link className="tab-strip-item" href="/audit-logs">
          Audit events
        </Link>
        <Link className="tab-strip-item" href="/audit-logs/history">
          Record history
        </Link>
        <Link className="tab-strip-item" href="/audit-logs/activity">
          User activity
        </Link>
        <span className="tab-strip-item active">Security events</span>
      </nav>

      <section className="dashboard-section" aria-labelledby="security-events-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Authentication &amp; access</p>
            <h2 id="security-events-title">Auth, access and module events</h2>
          </div>
        </div>
        <AuditEventTable rows={displayRows} emptyMessage="No security events recorded yet." />
        <GovernancePagination
          page={events.page}
          pageSize={events.pageSize}
          total={events.total}
          basePath="/audit-logs/security"
          extraParams={{ loginsPage: String(loginsPage) }}
          pageParam="eventsPage"
        />
      </section>

      <section className="dashboard-section" aria-labelledby="login-events-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Sign-in attempts</p>
            <h2 id="login-events-title">Login events</h2>
          </div>
        </div>
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Email</th>
                <th scope="col">Result</th>
                <th scope="col">Reason</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {logins.rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatTime(row.created_at)}</td>
                  <td>{row.email}</td>
                  <td>
                    <span
                      className={`status-badge ${row.succeeded ? "success" : "danger"}`}
                    >
                      {row.succeeded ? "Succeeded" : "Failed"}
                    </span>
                  </td>
                  <td>{row.reason || "—"}</td>
                  <td>{row.ip_address || "—"}</td>
                </tr>
              ))}
              {!logins.rows.length ? (
                <tr>
                  <td colSpan={5}>No sign-in attempts recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <GovernancePagination
          page={logins.page}
          pageSize={logins.pageSize}
          total={logins.total}
          basePath="/audit-logs/security"
          extraParams={{ eventsPage: String(eventsPage) }}
          pageParam="loginsPage"
        />
      </section>
    </>
  );
}

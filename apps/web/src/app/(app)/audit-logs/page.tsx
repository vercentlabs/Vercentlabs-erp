import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";

export const metadata = { title: "Audit logs" };
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; event?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.auditView)) notFound();
  const { q = "", event = "" } = await searchParams;
  const rows = await query<{
    id: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    ip_address: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>(
    `
    SELECT a.id,a.event_type,a.entity_type,a.entity_id,u.full_name AS actor_name,u.email AS actor_email,
      a.ip_address,a.metadata,a.created_at
    FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE a.organization_id=$1
      AND ($2='' OR a.event_type ILIKE '%' || $2 || '%')
      AND ($3='' OR a.entity_type ILIKE '%' || $3 || '%' OR COALESCE(a.entity_id,'') ILIKE '%' || $3 || '%' OR COALESCE(u.email,'') ILIKE '%' || $3 || '%')
    ORDER BY a.created_at DESC LIMIT 250
  `,
    [session.organizationId, event, q],
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance</p>
          <h1>Immutable audit log</h1>
          <p>
            Review authentication, access, configuration and organisation
            events.
          </p>
        </div>
      </section>
      <form className="filter-bar">
        <label>
          Event type
          <input name="event" defaultValue={event} placeholder="auth.login" />
        </label>
        <label>
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Entity, user or identifier"
          />
        </label>
        <button className="secondary-button" type="submit">
          Filter
        </button>
      </form>
      <section className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Actor</th>
              <th>Entity</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>
                  <strong>{row.event_type}</strong>
                </td>
                <td>
                  {row.actor_name || "System"}
                  <br />
                  <small>{row.actor_email || ""}</small>
                </td>
                <td>
                  {row.entity_type}
                  {row.entity_id ? ` · ${row.entity_id}` : ""}
                </td>
                <td>{row.ip_address || "—"}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={5}>No matching audit events.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

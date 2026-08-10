import Link from "next/link";
import { notFound } from "next/navigation";

import AuditEventTable, { type AuditEventDisplayRow } from "@/components/audit-event-table";
import GovernancePagination from "@/components/governance-pagination";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { redactAuditPayload } from "@/lib/audit/redact";
import { listAuditEvents } from "@/lib/audit/query";
import { query } from "@/lib/db";

export const metadata = { title: "User activity" };
export const dynamic = "force-dynamic";

export default async function UserActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; page?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.auditView)) notFound();

  const params = await searchParams;
  const actorUserId = params.actor || "";
  const page = Number(params.page || 1);

  const members = await query<{ id: string; full_name: string; email: string }>(
    `SELECT u.id, u.full_name, u.email
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND m.status = 'active'
      ORDER BY u.full_name`,
    [session.organizationId],
  );

  const result = actorUserId
    ? await listAuditEvents(session.organizationId as string, {
        actorUserId,
        page,
        pageSize: 50,
      })
    : { rows: [], total: 0, page: 1, pageSize: 50 };

  const displayRows: AuditEventDisplayRow[] = result.rows.map((row) => ({
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
          <h1>User activity</h1>
          <p>
            Operational and security-relevant actions taken by a specific
            workspace member — sign-ins, record changes, approvals and
            settings changes.
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
        <span className="tab-strip-item active">User activity</span>
        <Link className="tab-strip-item" href="/audit-logs/security">
          Security events
        </Link>
      </nav>

      <form className="filter-bar" aria-label="Choose a workspace member">
        <label>
          Workspace member
          <select name="actor" defaultValue={actorUserId} required>
            <option value="">Select a member…</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name} ({member.email})
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" type="submit">
          View activity
        </button>
      </form>

      {actorUserId ? (
        <>
          <AuditEventTable
            rows={displayRows}
            emptyMessage="No recorded activity for this workspace member yet."
          />
          <GovernancePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            basePath="/audit-logs/activity"
            extraParams={{ actor: actorUserId }}
          />
        </>
      ) : (
        <div className="empty-state">
          <strong>Select a workspace member</strong>
          <p>Choose someone above to review their recorded activity.</p>
        </div>
      )}
    </>
  );
}

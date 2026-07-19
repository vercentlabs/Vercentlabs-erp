import { requirePermission } from "@/lib/authorization";
import { query } from "@/lib/db";
import { formatDateTime } from "@vercent/localization";
import ApprovalActions from "@/components/approval-actions";

export const metadata = { title: "Approvals" };
export default async function ApprovalsPage() {
  const session = await requirePermission("approvals.manage");
  const rows = await query<{
    id: string;
    title: string;
    entity_type: string;
    entity_id: string;
    command_key: string | null;
    status: string;
    version: number;
    requested_at: Date;
    requester: string | null;
  }>(
    `
    SELECT a.id,a.title,a.entity_type,a.entity_id,a.command_key,a.status,a.version,a.requested_at,u.full_name AS requester
    FROM approval_requests a LEFT JOIN users u ON u.id=a.requested_by
    WHERE a.organization_id=$1 AND (a.assigned_to=$2 OR a.assigned_to IS NULL)
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.requested_at DESC LIMIT 100
  `,
    [session.organizationId, session.userId],
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Approval centre</p>
          <h1>Decisions requiring attention</h1>
          <p>
            Review governed requests with separation of duties, immutable
            decision history and transactional command execution.
          </p>
        </div>
      </section>
      <section className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Entity</th>
              <th>Requested by</th>
              <th>Status</th>
              <th>Time</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.title}</td>
                <td>
                  {row.entity_type} · {row.entity_id}
                </td>
                <td>{row.requester || "System"}</td>
                <td>
                  <span
                    className={`status-pill ${row.status === "approved" ? "active" : row.status === "pending" ? "pending" : "inactive"}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td>
                  {formatDateTime(row.requested_at, {
                    locale: session.locale,
                    timeZone: session.timezone,
                  })}
                </td>
                <td>
                  {row.status === "pending" && row.command_key ? (
                    <ApprovalActions
                      expectedVersion={row.version}
                      id={row.id}
                    />
                  ) : row.status === "pending" ? (
                    "Legacy request — command unavailable"
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>No approval requests are waiting.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

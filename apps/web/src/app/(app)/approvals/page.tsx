import { requireWorkspace } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata = { title: "Approvals" };
export default async function ApprovalsPage() {
  const session = await requireWorkspace();
  const rows = await query<{
    id: string;
    title: string;
    entity_type: string;
    entity_id: string;
    status: string;
    requested_at: Date;
    requester: string | null;
  }>(
    `
    SELECT a.id,a.title,a.entity_type,a.entity_id,a.status,a.requested_at,u.full_name AS requester
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
            Approval requests are visible for review, but decision execution is
            disabled until each workflow is bound to a transactional business
            command.
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
                <td>{new Date(row.requested_at).toLocaleString()}</td>
                <td>{row.status === "pending" ? "Execution disabled" : "—"}</td>
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

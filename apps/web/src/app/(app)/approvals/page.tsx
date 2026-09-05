import { formatDateTime } from "@vercentlabs/localization";

import ApprovalActions from "@/core/components/approval-actions";
import { requirePermission } from "@/core/authorization";
import { query } from "@/core/db";
import {
  EnterpriseDataGrid,
  ListWorkQueueArchetype,
  StatePanel,
  StatusBadge,
  type StatusTone,
} from "@/shared/design";

export const metadata = { title: "Approvals" };

type ApprovalRow = {
  id: string;
  title: string;
  entity_type: string;
  entity_id: string;
  command_key: string | null;
  status: string;
  version: number;
  requested_at: Date;
  requester: string | null;
};

function approvalTone(status: string): StatusTone {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export default async function ApprovalsPage() {
  const session = await requirePermission("approvals.manage");
  const rows = await query<ApprovalRow>(
    `
    SELECT a.id,a.title,a.entity_type,a.entity_id,a.command_key,a.status,a.version,a.requested_at,u.full_name AS requester
    FROM approval_requests a LEFT JOIN users u ON u.id=a.requested_by
    WHERE a.organization_id=$1 AND (a.assigned_to=$2 OR a.assigned_to IS NULL)
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.requested_at DESC LIMIT 100
  `,
    [session.organizationId, session.userId],
  );

  const columns = [
    {
      id: "request",
      header: "Request",
      cell: (row: ApprovalRow) => <strong>{row.title}</strong>,
    },
    {
      id: "entity",
      header: "Entity",
      cell: (row: ApprovalRow) => (
        <span>
          {row.entity_type} · {row.entity_id}
        </span>
      ),
    },
    {
      id: "requester",
      header: "Requested by",
      cell: (row: ApprovalRow) => row.requester || "System",
    },
    {
      id: "status",
      header: "Status",
      cell: (row: ApprovalRow) => (
        <StatusBadge tone={approvalTone(row.status)}>{row.status}</StatusBadge>
      ),
    },
    {
      id: "time",
      header: "Time",
      cell: (row: ApprovalRow) =>
        formatDateTime(row.requested_at, {
          locale: session.locale,
          timeZone: session.timezone,
        }),
    },
    {
      id: "decision",
      header: "Decision",
      cell: (row: ApprovalRow) =>
        row.status === "pending" && row.command_key ? (
          <ApprovalActions expectedVersion={row.version} id={row.id} />
        ) : row.status === "pending" ? (
          "Legacy request — command unavailable"
        ) : (
          "—"
        ),
    },
  ];

  return (
    <ListWorkQueueArchetype aria-label="Approval work queue">
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

      <EnterpriseDataGrid
        caption="Approval requests"
        rows={rows}
        rowKey="id"
        columns={columns}
        emptyState={
          <StatePanel
            title="No approval requests are waiting"
            description="New governed decisions assigned to you will appear here."
          />
        }
        renderMobileCard={(row) => (
          <article>
            <strong>{row.title}</strong>
            <p>
              {row.entity_type} · {row.entity_id}
            </p>
            <p>{row.requester || "System"}</p>
            <StatusBadge tone={approvalTone(row.status)}>{row.status}</StatusBadge>
            <p>
              {formatDateTime(row.requested_at, {
                locale: session.locale,
                timeZone: session.timezone,
              })}
            </p>
            {row.status === "pending" && row.command_key ? (
              <ApprovalActions expectedVersion={row.version} id={row.id} />
            ) : row.status === "pending" ? (
              <p>Legacy request — command unavailable</p>
            ) : null}
          </article>
        )}
      />
    </ListWorkQueueArchetype>
  );
}

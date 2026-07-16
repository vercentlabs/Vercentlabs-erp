import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { randomUUID } from "node:crypto";

import { requirePermission } from "@/lib/authorization";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { approvalDecisionSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requirePermission("approvals.manage");
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await context.params;
    const input = approvalDecisionSchema.parse(await readJson(request));
    const rows = await query<{
      id: string;
      title: string;
      status: string;
      requested_by: string | null;
      assigned_to: string | null;
    }>(
      `
      SELECT id,title,status,requested_by,assigned_to FROM approval_requests
      WHERE id=$1 AND organization_id=$2
    `,
      [id, session.organizationId],
    );
    const approval = rows[0];
    if (!approval) throw new HttpError(404, "Approval request not found.");
    if (approval.status !== "pending")
      throw new HttpError(409, "This request has already been decided.");
    if (approval.assigned_to && approval.assigned_to !== session.userId) {
      throw new HttpError(403, "This request is assigned to another user.");
    }
    const status = input.action === "approve" ? "approved" : "rejected";

    await transaction(async (client) => {
      const result = await client.query(
        `
        UPDATE approval_requests SET status=$3, decided_at=now(), decision_note=$4, assigned_to=COALESCE(assigned_to,$5)
        WHERE id=$1 AND organization_id=$2 AND status='pending'
      `,
        [
          id,
          session.organizationId,
          status,
          input.note || null,
          session.userId,
        ],
      );
      if (result.rowCount !== 1)
        throw new HttpError(
          409,
          "The request changed before your decision was saved.",
        );
      if (approval.requested_by && approval.requested_by !== session.userId) {
        await client.query(
          `
          INSERT INTO notifications (id,organization_id,user_id,type,title,message,href)
          VALUES ($1,$2,$3,'approval-decision',$4,$5,'/approvals')
        `,
          [
            randomUUID(),
            session.organizationId,
            approval.requested_by,
            `Approval ${status}`,
            `${approval.title} was ${status}.`,
          ],
        );
      }
    });

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: `approval.${status}`,
      entityType: "approval_request",
      entityId: id,
      beforeData: approval,
      afterData: { status, decisionNote: input.note },
      request,
    });
    return ok({ message: `Request ${status}.` });
  } catch (error) {
    return errorResponse(error);
  }
}

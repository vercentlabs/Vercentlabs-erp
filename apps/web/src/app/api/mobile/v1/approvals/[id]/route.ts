import { setTenantContext } from "@vercent/database";
import {
  assertApprovalDecision,
  assertSeparationOfDuties,
  WorkflowConflictError,
} from "@vercent/workflows";
import { z } from "zod";

import { getApprovalCommand } from "@/lib/approval-commands";
import { requirePermissionFromSession } from "@/lib/authorization";
import { requireBillingWriteAccess } from "@/lib/billing";
import { rethrowCrmError } from "@/lib/crm";
import { transaction } from "@/lib/db";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { audit } from "@/lib/security";
import { approvalDecisionSchema } from "@/lib/validation";

const identifier = z.string().uuid();

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, "approvals.manage");
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    const organizationId = session.organizationId;
    const workspaceSession = { ...session, organizationId };
    const id = identifier.parse((await route.params).id);
    const input = approvalDecisionSchema.parse(await readJson(request));
    const decision = assertApprovalDecision({
      decision: input.action === "approve" ? "approved" : "rejected",
      note: input.note,
      expectedVersion: input.expectedVersion,
    });
    if (decision.decision === "approved") {
      await requireBillingWriteAccess(session.organizationId);
    }

    const completed = await transaction(async (client) => {
      const result = await client.query<{
        id: string;
        title: string;
        entity_type: string;
        entity_id: string;
        command_key: string | null;
        command_payload: Record<string, unknown>;
        status: string;
        version: number;
        requested_by: string | null;
        assigned_to: string | null;
      }>(
        `SELECT id,title,entity_type,entity_id,command_key,command_payload,status,
                version,requested_by,assigned_to
         FROM approval_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [session.organizationId, id],
      );
      const approval = result.rows[0];
      if (!approval) throw new HttpError(404, "Approval request not found.");
      if (approval.assigned_to && approval.assigned_to !== session.userId) {
        throw new HttpError(403, "This request is assigned to another approver.");
      }
      if (approval.status !== "pending") {
        throw new HttpError(409, "This approval request has already been decided.");
      }
      if (approval.version !== decision.expectedVersion) {
        throw new HttpError(409, "This approval request changed. Refresh and try again.");
      }
      assertSeparationOfDuties({ requestedBy: approval.requested_by, actorUserId: session.userId });
      const command = approval.command_key ? getApprovalCommand(approval.command_key) : null;
      if (!command) throw new HttpError(409, "This request is not bound to a supported business command.");
      let commandResult: unknown = null;
      if (decision.decision === "approved") {
        requirePermissionFromSession(session, command.permission);
        const payload = command.validate(approval.command_payload);
        await setTenantContext(client, organizationId);
        commandResult = await command.execute({ client, session: workspaceSession }, payload);
      }
      const updated = await client.query<{ status: string; version: number; decided_at: Date }>(
        `UPDATE approval_requests SET status=$1,decision_note=$2,decided_by=$3,
           decided_at=now(),version=version+1,updated_at=now()
         WHERE organization_id=$4 AND id=$5 AND status='pending' AND version=$6
         RETURNING status,version,decided_at`,
        [decision.decision, decision.note, session.userId, session.organizationId, id, decision.expectedVersion],
      );
      if (!updated.rows[0]) throw new HttpError(409, "This approval request changed. Refresh and try again.");
      await client.query(
        `INSERT INTO approval_decisions (organization_id,approval_request_id,version,decision,note,decided_by,command_result)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [session.organizationId, id, decision.expectedVersion, decision.decision, decision.note, session.userId, commandResult === null ? null : JSON.stringify(commandResult)],
      );
      if (approval.requested_by && approval.requested_by !== session.userId) {
        await client.query(
          `INSERT INTO notifications (organization_id,user_id,type,title,message,href)
           VALUES ($1,$2,'approval_decided',$3,$4,'/approvals')`,
          [session.organizationId, approval.requested_by, `Approval ${decision.decision}`, approval.title],
        );
      }
      await audit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: `approval.${decision.decision}`,
        entityType: "approval_request",
        entityId: id,
        beforeData: { status: approval.status, version: approval.version },
        afterData: updated.rows[0],
        metadata: { commandKey: command.key },
        request,
        client,
      });
      return updated.rows[0];
    });
    return mobileOk(request, { message: `Approval request ${decision.decision}.`, request: completed });
  } catch (error) {
    if (error instanceof WorkflowConflictError || error instanceof TypeError || error instanceof RangeError) {
      return mobileError(request, new HttpError(error instanceof WorkflowConflictError ? 409 : 400, error.message));
    }
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return mobileError(request, mapped);
    }
  }
}

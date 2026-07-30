import { setTenantContext } from "@vercentlabs/database";
import {
  assertApprovalDecision,
  assertSeparationOfDuties,
  WorkflowConflictError,
} from "@vercentlabs/workflows";
import { z } from "zod";

import { getApprovalCommand } from "@/lib/approval-commands";
import {
  requireApiPermission,
  requirePermissionFromSession,
} from "@/lib/authorization";
import { requireBillingWriteAccess } from "@/lib/billing";
import { rethrowCrmError } from "@/lib/crm";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { approvalDecisionSchema } from "@/lib/validation";

const identifier = z.string().uuid();

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireApiPermission("approvals.manage");
    const id = identifier.parse((await route.params).id);
    const rows = await query(
      `SELECT approval.id, approval.title, approval.entity_type,
              approval.entity_id, approval.command_key, approval.command_payload,
              approval.status, approval.version, approval.requested_at,
              approval.decided_at, approval.decision_note,
              requester.full_name AS requester, assignee.full_name AS assignee,
              decider.full_name AS decider
         FROM approval_requests approval
         LEFT JOIN users requester ON requester.id = approval.requested_by
         LEFT JOIN users assignee ON assignee.id = approval.assigned_to
         LEFT JOIN users decider ON decider.id = approval.decided_by
        WHERE approval.organization_id = $1 AND approval.id = $2
          AND (approval.assigned_to = $3 OR approval.assigned_to IS NULL)`,
      [session.organizationId, id, session.userId],
    );
    if (!rows[0]) throw new HttpError(404, "Approval request not found.");
    return ok({ request: rows[0] as Record<string, unknown> });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("approvals.manage");
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
        `SELECT id, title, entity_type, entity_id, command_key,
                command_payload, status, version, requested_by, assigned_to
           FROM approval_requests
          WHERE organization_id = $1 AND id = $2
          FOR UPDATE`,
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
      assertSeparationOfDuties({
        requestedBy: approval.requested_by,
        actorUserId: session.userId,
      });

      const command = approval.command_key
        ? getApprovalCommand(approval.command_key)
        : null;
      if (!command) {
        throw new HttpError(
          409,
          "This legacy request is not bound to a supported business command.",
        );
      }

      let commandResult: unknown = null;
      const payload = command.validate(approval.command_payload);
      await setTenantContext(client, session.organizationId);
      if (decision.decision === "approved") {
        requirePermissionFromSession(session, command.permission);
        commandResult = await command.execute({ client, session }, payload);
      } else if (command.reject) {
        commandResult = await command.reject({ client, session }, payload);
      }

      const updated = await client.query<{
        status: string;
        version: number;
        decided_at: Date;
      }>(
        `UPDATE approval_requests
            SET status = $1, decision_note = $2, decided_by = $3,
                decided_at = now(), version = version + 1, updated_at = now()
          WHERE organization_id = $4 AND id = $5 AND status = 'pending'
            AND version = $6
          RETURNING status, version, decided_at`,
        [
          decision.decision,
          decision.note,
          session.userId,
          session.organizationId,
          id,
          decision.expectedVersion,
        ],
      );
      if (!updated.rows[0]) {
        throw new HttpError(409, "This approval request changed. Refresh and try again.");
      }

      await client.query(
        `INSERT INTO approval_decisions (
           organization_id, approval_request_id, version, decision, note,
           decided_by, command_result
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          session.organizationId,
          id,
          decision.expectedVersion,
          decision.decision,
          decision.note,
          session.userId,
          commandResult === null ? null : JSON.stringify(commandResult),
        ],
      );

      if (approval.requested_by && approval.requested_by !== session.userId) {
        await client.query(
          `INSERT INTO notifications (
             organization_id, user_id, type, title, message, href
           ) VALUES ($1,$2,'approval_decided',$3,$4,$5)`,
          [
            session.organizationId,
            approval.requested_by,
            `Approval ${decision.decision}`,
            approval.title,
            "/approvals",
          ],
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

    return ok({
      message: `Approval request ${decision.decision}.`,
      request: completed,
    });
  } catch (error) {
    if (error instanceof WorkflowConflictError) {
      return errorResponse(new HttpError(409, error.message));
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      return errorResponse(new HttpError(400, error.message));
    }
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

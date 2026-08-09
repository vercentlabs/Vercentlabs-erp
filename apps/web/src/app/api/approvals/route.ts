import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getApprovalCommand } from "@/lib/approval-commands";
import { getSessionContext } from "@/lib/auth";
import {
  requireApiPermission,
  requirePermissionFromSession,
} from "@/lib/authorization";
import { requireBillingWriteAccess } from "@/lib/billing";
import { transaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { listMyApprovals } from "@/lib/my-work/approvals";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

const createApprovalSchema = z.object({
  commandKey: z.string().trim().min(3).max(120),
  commandPayload: z.record(z.string(), z.unknown()),
  assignedTo: z.string().uuid().optional().nullable(),
});

export async function GET() {
  try {
    const session = await requireApiPermission("approvals.manage");
    const requests = await listMyApprovals(session, 100);
    return ok({ requests });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    await requireBillingWriteAccess(session.organizationId);
    const input = createApprovalSchema.parse(await readJson(request));
    const command = getApprovalCommand(input.commandKey);
    if (!command) throw new HttpError(400, "Unsupported approval command.");
    requirePermissionFromSession(session, command.permission);
    const payload = command.validate(input.commandPayload);
    const id = randomUUID();

    await transaction(async (client) => {
      if (input.assignedTo) {
        const assignee = await client.query(
          `SELECT 1 FROM organization_memberships
            WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
          [session.organizationId, input.assignedTo],
        );
        if (!assignee.rows[0]) {
          throw new HttpError(
            400,
            "The selected approver is not active in this organisation.",
          );
        }
      }

      await client.query(
        `INSERT INTO approval_requests (
           id, organization_id, entity_type, entity_id, title, requested_by,
           assigned_to, command_key, command_payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          id,
          session.organizationId,
          command.entityType,
          command.entityId(payload),
          command.title(payload),
          session.userId,
          input.assignedTo || null,
          command.key,
          JSON.stringify(payload),
        ],
      );

      if (input.assignedTo) {
        await client.query(
          `INSERT INTO notifications (
             organization_id, user_id, type, title, message, href
           ) VALUES ($1,$2,'approval_requested','Approval requested',$3,$4)`,
          [
            session.organizationId,
            input.assignedTo,
            command.title(payload),
            "/approvals",
          ],
        );
      }

      await audit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "approval.requested",
        entityType: "approval_request",
        entityId: id,
        afterData: {
          commandKey: command.key,
          entityType: command.entityType,
          entityId: command.entityId(payload),
          assignedTo: input.assignedTo || null,
        },
        request,
        client,
      });
    });

    return ok({ id, message: "Approval request created." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

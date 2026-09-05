import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { executeWorkflowRun } from "@/core/shared-platform";

const schema = z.object({
  workflowId: z.string().uuid(),
  triggerKey: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(120),
  entityId: z.string().trim().min(1).max(240),
  idempotencyKey: z.string().trim().min(8).max(240),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.workflows.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = schema.parse(await readJson(request));
    const result = await transaction((client) => executeWorkflowRun(client, session, input));
    if (!result.replayed) {
      await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: "platform.workflow.executed", entityType: "workflow_run", entityId: result.id, afterData: { triggerKey: input.triggerKey, entityType: input.entityType, entityId: input.entityId, status: result.status }, request });
    }
    return ok({ ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

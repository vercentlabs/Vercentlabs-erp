import { updateCloseTask } from "@vercentlabs/api";

import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string; taskId: string }> },
) {
  try {
    assertSameOrigin(request);
    const { session, context } = await accountingSession(true);
    const { id, taskId } = await route.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const run = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await updateCloseTask(client, context, id, taskId, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType:
          input.status === "waived"
            ? "accounting.close.task_waived"
            : "accounting.close.task_updated",
        entityType: "accounting_close_task",
        entityId: taskId,
        afterData: { runId: id, ...input },
        request,
        client,
      });
      return updated;
    });
    return ok({ run });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

import { completeCloseRun } from "@vercentlabs/api";

import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { session, context } = await accountingSession(true);
    const { id } = await route.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    if (input.action !== "complete") {
      throw new HttpError(400, "Unsupported close action.");
    }
    const run = await tenantTransaction(context.organizationId, async (client) => {
      const completed = await completeCloseRun(client, context, id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "accounting.close.completed",
        entityType: "accounting_close_run",
        entityId: id,
        afterData: {
          expectedVersion: input.expectedVersion,
          status: "completed",
        },
        request,
        client,
      });
      return completed;
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

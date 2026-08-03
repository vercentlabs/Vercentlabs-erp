import { getCrmCoreAcceptanceTimeline } from "@vercentlabs/api";

import {
  crmCoreAcceptanceSession,
  tenantTransaction,
} from "@/lib/crm-core-acceptance-route";
import { errorResponse, fail, ok } from "@/lib/http";

function acceptanceError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "message" in error &&
    typeof error.status === "number" &&
    typeof error.message === "string"
  ) {
    return fail(error.message, error.status);
  }
  return errorResponse(error);
}

export async function GET() {
  try {
    const { context } = await crmCoreAcceptanceSession();
    return ok({
      timeline: await tenantTransaction(context.organizationId, (client) =>
        getCrmCoreAcceptanceTimeline(client, context),
      ),
    });
  } catch (error) {
    return acceptanceError(error);
  }
}

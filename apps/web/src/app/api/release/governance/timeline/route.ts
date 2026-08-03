import { getReleaseGovernanceTimeline } from "@vercentlabs/api";

import {
  releaseGovernanceSession,
  tenantTransaction,
} from "@/lib/release-governance-route";
import { errorResponse, fail, ok } from "@/lib/http";

function releaseError(error: unknown) {
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
    const { context } = await releaseGovernanceSession();
    return ok({
      timeline: await tenantTransaction(context.organizationId, (client) =>
        getReleaseGovernanceTimeline(client, context),
      ),
    });
  } catch (error) {
    return releaseError(error);
  }
}

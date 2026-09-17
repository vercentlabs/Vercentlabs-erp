import { listBackgroundJobs } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "all";
    const jobs = await tenantTransaction(session.organizationId, (client) =>
      listBackgroundJobs(client, session.organizationId, { status }),
    );
    return ok({ jobs });
  } catch (error) {
    return errorResponse(error);
  }
}

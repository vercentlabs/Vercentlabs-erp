import { listApprovals } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending";
    const approvals = await withClient((client) =>
      listApprovals(client, session, { status }),
    );
    return ok({ approvals });
  } catch (error) {
    return errorResponse(error);
  }
}

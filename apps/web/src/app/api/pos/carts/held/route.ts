import { listHeldPosCarts } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const search = url.searchParams.get("q") || undefined;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listHeldPosCarts(client, posContext(session), { search });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

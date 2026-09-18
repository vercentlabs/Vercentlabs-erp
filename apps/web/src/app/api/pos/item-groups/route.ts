import { searchPointOfSaleItemGroups } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";
    const limit = url.searchParams.get("limit");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return searchPointOfSaleItemGroups(client, posContext(session), {
        query,
        limit: limit ? Number(limit) : undefined,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

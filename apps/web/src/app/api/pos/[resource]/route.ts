import { listPointOfSaleResource } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const session = await requireWorkspace();
    const { resource } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const shiftId = url.searchParams.get("shiftId");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPointOfSaleResource(client, posContext(session), resource, {
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        shiftId: shiftId || null,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

import { getPosShift } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const shift = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return getPosShift(client, posContext(session), id);
    });
    return ok({ shift });
  } catch (error) {
    return errorResponse(error);
  }
}

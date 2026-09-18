import { listPosCustomerLoyaltyLedger } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request, context: { params: Promise<{ customerId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { customerId } = await context.params;
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPosCustomerLoyaltyLedger(client, posContext(session), customerId, { limit: limitParam ? Number(limitParam) : undefined });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

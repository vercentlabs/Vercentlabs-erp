import { getPosCustomerLoyaltyBalance } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request, context: { params: Promise<{ customerId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { customerId } = await context.params;
    const balance = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return getPosCustomerLoyaltyBalance(client, posContext(session), customerId);
    });
    return ok({ balance });
  } catch (error) {
    return errorResponse(error);
  }
}

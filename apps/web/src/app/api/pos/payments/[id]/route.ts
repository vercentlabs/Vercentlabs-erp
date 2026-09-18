import { getPosPaymentStatus } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Polled by the checkout UI while a non-cash leg is pending/authorized --
// there is no client-side "it succeeded," only whatever the server reports
// here, which only ever reflects an adapter's own synchronous response or
// a verified webhook (see features/payments.js).
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.view");
      return getPosPaymentStatus(client, posContext(session), id);
    });
    return ok({ payment: result });
  } catch (error) {
    return errorResponse(error);
  }
}

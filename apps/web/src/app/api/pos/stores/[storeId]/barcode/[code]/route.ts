import { lookupPointOfSaleBarcode } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(_request: Request, context: { params: Promise<{ storeId: string; code: string }> }) {
  try {
    const session = await requireWorkspace();
    const { storeId, code } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return lookupPointOfSaleBarcode(client, posContext(session), storeId, decodeURIComponent(code));
    });
    return ok({ product: result });
  } catch (error) {
    return errorResponse(error);
  }
}

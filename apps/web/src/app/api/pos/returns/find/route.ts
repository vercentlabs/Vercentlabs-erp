import { findPosSaleForReturn } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const receiptNumber = url.searchParams.get("receiptNumber") || "";
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.return.create");
      return findPosSaleForReturn(client, posContext(session), { receiptNumber });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

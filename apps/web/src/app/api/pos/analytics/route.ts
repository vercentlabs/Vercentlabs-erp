import { getPosSalesAnalytics } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.analytics.view");
      return getPosSalesAnalytics(client, posContext(session), {
        dateFrom: url.searchParams.get("dateFrom") || "",
        dateTo: url.searchParams.get("dateTo") || "",
        storeId: url.searchParams.get("storeId") || undefined,
        terminalId: url.searchParams.get("terminalId") || undefined,
        cashierId: url.searchParams.get("cashierId") || undefined,
      });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

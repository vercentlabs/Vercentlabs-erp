import { getPosSalesAnalytics } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.analytics.view" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const result = await getPosSalesAnalytics(client, posContext(session), {
      dateFrom: url.searchParams.get("dateFrom") || "",
      dateTo: url.searchParams.get("dateTo") || "",
      storeId: url.searchParams.get("storeId") || undefined,
      terminalId: url.searchParams.get("terminalId") || undefined,
      cashierId: url.searchParams.get("cashierId") || undefined,
    });
    return ok(result);
  });
}

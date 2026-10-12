import { listPointOfSaleResource } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// The shift list. Shifts are opened through POST /api/pos/shifts/open (Shift Opening).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "point-of-sale" },
    async ({ client, session }) => {
      const url = new URL(request.url);
      const withTotal = url.searchParams.get("withTotal") === "1";
      const result = await listPointOfSaleResource(
        client,
        posContext(session),
        "shifts",
        {
          limit: url.searchParams.get("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
          offset: url.searchParams.get("offset")
            ? Number(url.searchParams.get("offset"))
            : undefined,
          storeId: url.searchParams.get("storeId") || undefined,
          terminalId: url.searchParams.get("terminalId") || undefined,
          status: url.searchParams.get("status") || undefined,
          cashierUserId: url.searchParams.get("cashierUserId") || undefined,
          dateFrom: url.searchParams.get("dateFrom") || undefined,
          dateTo: url.searchParams.get("dateTo") || undefined,
          withTotal,
        },
      );
      return ok(
        withTotal
          ? (result as { rows: unknown[]; total: number })
          : { rows: result },
      );
    },
  );
}

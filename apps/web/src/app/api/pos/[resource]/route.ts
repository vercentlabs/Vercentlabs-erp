import { listPointOfSaleResource } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const { resource } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const shiftId = url.searchParams.get("shiftId");
    const withTotal = url.searchParams.get("withTotal") === "1";
    const result = await listPointOfSaleResource(client, posContext(session), resource, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      shiftId: shiftId || null,
      storeId: url.searchParams.get("storeId") || undefined,
      terminalId: url.searchParams.get("terminalId") || undefined,
      movementType: url.searchParams.get("movementType") || undefined,
      cashierUserId: url.searchParams.get("cashierUserId") || undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      withTotal,
    });
    return ok(withTotal ? (result as { rows: unknown[]; total: number }) : { rows: result });
  });
}

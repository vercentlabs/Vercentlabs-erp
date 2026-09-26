import { listPosReconciliations } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.reconciliation.view" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPosReconciliations(client, posContext(session), {
      storeId: url.searchParams.get("storeId") || undefined,
      dayEndReportId: url.searchParams.get("dayEndReportId") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return ok({ rows });
  });
}

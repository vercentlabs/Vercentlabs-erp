import { listPosInvoices } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.invoice.view" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPosInvoices(client, posContext(session), {
      storeId: url.searchParams.get("storeId") || undefined,
      customerId: url.searchParams.get("customerId") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return ok({ rows });
  });
}

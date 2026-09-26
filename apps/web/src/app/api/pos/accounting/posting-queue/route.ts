import { listPosAccountingPostingQueue } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.accounting.view" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPosAccountingPostingQueue(client, posContext(session), {
      status: url.searchParams.get("status") || undefined,
      storeId: url.searchParams.get("storeId") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    });
    return ok({ rows });
  });
}

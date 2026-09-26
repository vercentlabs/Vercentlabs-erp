import { searchPointOfSalePosProducts } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const { storeId } = await context.params;
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";
    const limit = url.searchParams.get("limit");
    const rows = await searchPointOfSalePosProducts(client, posContext(session), storeId, {
      query,
      limit: limit ? Number(limit) : undefined,
    });
    return ok({ rows });
  });
}

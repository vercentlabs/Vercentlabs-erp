import { searchPointOfSaleCustomers } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const rows = await searchPointOfSaleCustomers(client, posContext(session), {
      query,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return ok({ rows });
  });
}

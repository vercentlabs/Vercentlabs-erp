import { listHeldPosCarts } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("q") || undefined;
    const rows = await listHeldPosCarts(client, posContext(session), { search });
    return ok({ rows });
  });
}

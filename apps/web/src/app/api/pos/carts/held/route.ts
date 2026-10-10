import { listHeldPosCarts } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "point-of-sale" },
    async ({ client, session }) => {
      const url = new URL(request.url);
      const search = url.searchParams.get("q") || undefined;
      // mine | all; held between from and to (dates).
      const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";
      const from = url.searchParams.get("from") || undefined;
      const to = url.searchParams.get("to") || undefined;
      const rows = await listHeldPosCarts(client, posContext(session), {
        search, scope, from, to,
      });
      return ok({ rows });
    },
  );
}

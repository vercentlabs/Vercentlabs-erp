import { listPointOfSaleResource } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// The outlets the POS screens pick from (checkout, shifts, terminals, reports), filtered to the outlets the person may work at. Outlets
// themselves are maintained under /api/pos/outlets.
//
// A static "stores" segment always wins over the sibling dynamic
// [resource]/route.ts for this exact path (Next.js resolves to a FILE
// first, then checks the method within it — it does not fall through to a
// dynamic sibling on an unmatched method), so GET has to live here rather
// than being handled generically.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "point-of-sale" },
    async ({ client, session }) => {
      const url = new URL(request.url);
      const rows = await listPointOfSaleResource(
        client,
        posContext(session),
        "stores",
        {
          limit: url.searchParams.get("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
          offset: url.searchParams.get("offset")
            ? Number(url.searchParams.get("offset"))
            : undefined,
        },
      );
      return ok({ rows });
    },
  );
}

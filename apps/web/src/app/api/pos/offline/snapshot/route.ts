import { z } from "zod";

import { getPosOfflineSnapshot } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const querySchema = z.object({ storeId: z.string().uuid() });

// F297: the bounded catalog/price/tax/permission snapshot a device fetches
// while online and refreshes periodically. See getPosOfflineSnapshot
// (services/api/src/modules/point-of-sale/features/offline-sync.js) for
// the exact bound (a store's own sales price list, capped at 2000 items)
// and for OFFLINE_UNSUPPORTED_OPERATIONS, which this response always
// includes so the client can render/enforce it verbatim.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.offline.sync" }, async ({ client, session }) => {
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({ storeId: searchParams.get("storeId") });
    const result = await getPosOfflineSnapshot(client, posContext(session), input);
    return ok({ snapshot: result });
  });
}

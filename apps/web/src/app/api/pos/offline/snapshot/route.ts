import { z } from "zod";

import { assertSameOriginOrMobile, getPosOfflineSnapshot } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const querySchema = z.object({ storeId: z.string().uuid() });

// F297: the bounded catalog/price/tax/permission snapshot a device fetches
// while online and refreshes periodically. See getPosOfflineSnapshot
// (services/api/src/modules/point-of-sale/features/offline-sync.js) for
// the exact bound (a store's own sales price list, capped at 2000 items)
// and for OFFLINE_UNSUPPORTED_OPERATIONS, which this response always
// includes so the client can render/enforce it verbatim.
export async function GET(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({ storeId: searchParams.get("storeId") });
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.offline.sync");
      return getPosOfflineSnapshot(client, posContext(session), input);
    });
    return ok({ snapshot: result });
  } catch (error) {
    return errorResponse(error);
  }
}

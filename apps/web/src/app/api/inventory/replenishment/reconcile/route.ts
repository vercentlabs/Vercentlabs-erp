import { reconcileReorderStatusProjection } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Recalculate every rule from its sources now (the daily job does this too); reports what the projection had wrong.
export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ reconciliation: await reconcileReorderStatusProjection(client, context) }), 200,
    STOCK_REORDER_PERMISSIONS.edit);
}

import { createHoldReason, listHoldReasons } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  return inventoryRead(request, async (client, context) => ({ reasons: await listHoldReasons(client, context, { includeInactive }) }), STOCK_HOLD_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ reason: await createHoldReason(client, context, input) }), 201,
    STOCK_HOLD_PERMISSIONS.manageReasons);
}

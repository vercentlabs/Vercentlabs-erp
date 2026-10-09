import { getNegativeStockSettings, updateNegativeStockPolicy } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// The company policy: Block (the default) or Allow with authorised override; there is no unrestricted allow. Every change is audited.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ settings: await getNegativeStockSettings(client, context) }));
}

const schema = z.object({ policy: z.enum(["block", "allow_with_override"]).optional(), alertsEnabled: z.boolean().optional(), reason: z.string().max(1000).nullable().optional() });

export async function PATCH(request: Request) {
  return inventoryMutation(request, schema, async (client, context, input) => ({ settings: await updateNegativeStockPolicy(client, context, input) }), 200,
    NEGATIVE_STOCK_PERMISSIONS.configure);
}

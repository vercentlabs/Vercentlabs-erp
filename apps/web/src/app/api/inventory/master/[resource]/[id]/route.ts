import { z } from "zod";

import { updateBusinessDataRecord, requireSessionPermission } from "@vercentlabs/api";

import { guardItemIdentity, INVENTORY_MASTER, masterResource, shapeMasterUpdate } from "@/features/inventory/server/master";
import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// "Delete" is an update to status=inactive; history that references the record stays intact.
export async function PATCH(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input, session) => {
    const name = masterResource(resource);
    requireSessionPermission(session, INVENTORY_MASTER[name].permission);
    const shaped = shapeMasterUpdate(input);
    if (name === "items") await guardItemIdentity(client, context.organizationId, id, shaped);
    return { record: await updateBusinessDataRecord(client, context, name, id, shaped) };
  });
}

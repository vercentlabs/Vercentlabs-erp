import { z } from "zod";

import { updatePosStore } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const updateStoreSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  currencyCode: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage", billingWrite: true }, async ({ client, session }) => {
    const { storeId } = await context.params;
    const input = updateStoreSchema.parse(await readJson(request));
    const result = await updatePosStore(client, posContext(session), storeId, input);
    return ok({ store: result });
  });
}

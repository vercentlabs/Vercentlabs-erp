import { z } from "zod";

import { assertSameOriginOrMobile, updatePosStore } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const updateStoreSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  currencyCode: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { storeId } = await context.params;
    const input = updateStoreSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage", { mutation: true });
      return updatePosStore(client, posContext(session), storeId, input);
    });
    return ok({ store: result });
  } catch (error) {
    return errorResponse(error);
  }
}

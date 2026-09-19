import { z } from "zod";

import { listPosStoreInventory } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const querySchema = z.object({
  storeId: z.string().uuid(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      storeId: searchParams.get("storeId") || undefined,
      search: searchParams.get("search") || undefined,
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
    });
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.view");
      return listPosStoreInventory(client, posContext(session), input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

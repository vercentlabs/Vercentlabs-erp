import { z } from "zod";

import { listPosStoreInventory } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const querySchema = z.object({
  storeId: z.string().uuid(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.view" }, async ({ client, session }) => {
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      storeId: searchParams.get("storeId") || undefined,
      search: searchParams.get("search") || undefined,
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
    });
    const result = await listPosStoreInventory(client, posContext(session), input);
    return ok(result);
  });
}

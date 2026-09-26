import { z } from "zod";

import { createStore, listPointOfSaleResource } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const createStoreSchema = z.object({
  branchId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  priceListId: z.string().uuid().optional().nullable(),
  currencyCode: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(1).max(60).optional(),
});

// A static "stores" segment always wins over the sibling dynamic
// [resource]/route.ts for this exact path (Next.js resolves to a FILE
// first, then checks the method within it — it does not fall through to a
// dynamic sibling on an unmatched method), so GET has to live here rather
// than being handled generically.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPointOfSaleResource(client, posContext(session), "stores", {
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage", billingWrite: true }, async ({ client, session }) => {
    const input = createStoreSchema.parse(await readJson(request));
    const result = await createStore(client, posContext(session), input);
    return ok({ store: result }, 201);
  });
}

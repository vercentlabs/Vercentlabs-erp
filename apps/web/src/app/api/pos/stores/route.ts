import { z } from "zod";

import { assertSameOriginOrMobile, createStore, listPointOfSaleResource } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

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
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPointOfSaleResource(client, posContext(session), "stores", {
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = createStoreSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return createStore(client, posContext(session), input);
    });
    return ok({ store: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

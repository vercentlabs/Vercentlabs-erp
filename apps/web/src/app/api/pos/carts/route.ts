import { z } from "zod";

import { assertSameOriginOrMobile, createPosCart } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const createCartSchema = z.object({
  storeId: z.string().uuid(),
  terminalId: z.string().uuid(),
  shiftId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = createCartSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return createPosCart(client, posContext(session), input);
    });
    return ok({ cart: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

import { z } from "zod";

import { assertSameOriginOrMobile, setPosCartDiscount } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// A null type clears the cart-level discount; the domain layer accepts
// this in a single POST rather than a separate DELETE since removing a
// cart discount and setting one are the same "set current state" action.
// F279 (POS Session 3): `approvedBy` is deliberately not accepted here --
// see the matching comment in lines/[lineId]/discount/route.ts.
const discountSchema = z.object({
  type: z.enum(["percent", "amount"]).nullable(),
  value: z.number().positive().optional(),
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = discountSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.discount.apply");
      return setPosCartDiscount(client, posContext(session), id, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}

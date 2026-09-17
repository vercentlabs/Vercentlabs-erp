import { z } from "zod";

import { assertSameOriginOrMobile, completePosCart } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Shape-level validation only -- completePosCart re-prices the cart fresh
// inside its own transaction and never trusts a client-supplied total; a
// mismatch against expectedGrandTotal surfaces as a POS_PRICE_CONFLICT,
// not a silently-accepted amount.
const completeSchema = z.object({
  payments: z.array(z.object({ method: z.enum(["cash", "card", "upi", "bank_transfer", "wallet", "store_credit"]), amount: z.number().positive() })).min(1),
  idempotencyKey: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().optional(),
  expectedGrandTotal: z.string().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = completeSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create");
      return completePosCart(client, posContext(session), id, input);
    });
    return ok({ sale: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

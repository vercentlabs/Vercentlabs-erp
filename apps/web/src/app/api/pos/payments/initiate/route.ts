import { z } from "zod";

import { assertSameOriginOrMobile, initiatePosPayment } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// F283 (card) / F284 (UPI/digital) / F286 (multiple payment methods):
// starts a non-cash tender leg on a priced cart. Never completes the sale
// itself -- see POST /api/pos/carts/[id]/complete, which only accepts an
// already-captured paymentId for any non-cash leg.
const initiateSchema = z.object({
  cartId: z.string().uuid(),
  method: z.enum(["card", "upi", "wallet", "bank_transfer"]),
  amount: z.number().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
  // Sandbox-only test/dev scripting instruction (see
  // services/api/src/modules/point-of-sale/payments/sandbox-adapter.js) --
  // never trusted as a truth claim about payment state. A real (non-
  // sandbox) adapter ignores this field entirely.
  outcome: z.string().trim().max(64).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = initiateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create");
      return initiatePosPayment(client, posContext(session), input);
    });
    return ok({ payment: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

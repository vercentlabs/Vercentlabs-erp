import { z } from "zod";

import { initiatePosPayment } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

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
  // services/api/src/modules/point-of-sale/tender-and-payment-execution/sandbox-adapter.js) --
  // never trusted as a truth claim about payment state. A real (non-
  // sandbox) adapter ignores this field entirely.
  outcome: z.string().trim().max(64).optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const input = initiateSchema.parse(await readJson(request));
    const result = await initiatePosPayment(client, posContext(session), input);
    return ok({ payment: result }, 201);
  });
}

import { z } from "zod";

import { completePosExchange } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const exchangeSchema = z.object({
  cartId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  payments: z.array(z.object({ method: z.literal("cash"), amount: z.number().min(0) })).min(1),
  expectedVersion: z.number().int().optional(),
  expectedGrandTotal: z.string().optional(),
});

// completePosExchange requires the return to already be approved
// (pos.return.approve, decided by someone other than the requester) and
// requires pos.sale.create for the replacement sale -- gated here on
// pos.sale.create since that is the narrower of the two floors a caller
// must pass to even reach the domain function's own approved-status check.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.sale.create", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = exchangeSchema.parse(await readJson(request));
    const result = await completePosExchange(client, posContext(session), { ...input, returnId: id });
    return ok(result);
  });
}

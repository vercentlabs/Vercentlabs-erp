import { z } from "zod";

import { removePosCartDiscount, setPosCartDiscount } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { posContext } from "@/features/pos/shared/pos-context";
import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The bill discount (Cart Discounts): a percentage of the eligible value or a fixed amount off it, with a reason. One per bill — a new one
// replaces it. The server works out what is eligible, the amount, the shares and the tax, and checks the cashier's limits; above them a
// supervisor's approval for exactly this discount (approvalId). 0 removes it.
const schema = z.object({
  type: z.enum(["percent", "amount", "percentage", "fixed", "PERCENTAGE", "FIXED_AMOUNT"]),
  value: z.union([z.string().trim().max(20), z.number().nonnegative()]),
  reasonCode: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(500).nullish(),
  approvalId: z.string().uuid().optional(),
  expectedVersion: z.number().int(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ cart: await setPosCartDiscount(client, context, id, { ...input, value: String(input.value) }) }),
    200, "pos.discount.apply");
}

// Remove the bill discount (lines and tax are worked out again; the history keeps it).
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(request.url);
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.discount.apply", billingWrite: true }, async ({ client, session }) => ok(toWire({
    cart: await removePosCartDiscount(client as never, posContext(session), id, {
      expectedVersion: url.searchParams.get("expectedVersion") ? Number(url.searchParams.get("expectedVersion")) : undefined,
      idempotencyKey: url.searchParams.get("idempotencyKey") ?? undefined,
    }),
  }) as Record<string, unknown>));
}

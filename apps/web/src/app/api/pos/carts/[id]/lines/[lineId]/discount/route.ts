import { z } from "zod";

import { applyPosCartLineDiscount, removePosCartLineDiscount } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { posContext } from "@/features/pos/shared/pos-context";
import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string; lineId: string }> };

// A cashier's discount on one line: a percentage of the line or a fixed amount off the whole line, with a reason code. Checked by the
// pricing engine (product policy, stacking, never above the line) and the cashier's limits; above them, a supervisor's approval for exactly
// this line (approvalId). 0 removes it. A caller can never say who approved it or what it amounts to: the server works both out.
const schema = z.object({
  type: z.enum(["percent", "amount"]),
  value: z.union([z.string().trim().max(20), z.number().nonnegative()]),
  reasonCode: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(500).nullish(),
  reason: z.string().trim().max(500).nullish(),
  approvalId: z.string().uuid().optional(),
  expectedVersion: z.number().int(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

const apply = (request: Request, { params }: Params) => params.then(({ id, lineId }) =>
  posMutation(request, schema, async (client, context, input) => ({ cart: await applyPosCartLineDiscount(client, context, id, lineId, { ...input, value: String(input.value) }) }),
    200, "pos.discount.apply"));

export const POST = apply;
export const PUT = apply;

// Remove the line's manual discount (any promotion still applies; the history keeps what was there).
export async function DELETE(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  const url = new URL(request.url);
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.discount.apply", billingWrite: true }, async ({ client, session }) => ok(toWire({
    cart: await removePosCartLineDiscount(client as never, posContext(session), id, lineId, {
      expectedVersion: url.searchParams.get("expectedVersion") ? Number(url.searchParams.get("expectedVersion")) : undefined,
      idempotencyKey: url.searchParams.get("idempotencyKey") ?? undefined,
    }),
  }) as Record<string, unknown>));
}

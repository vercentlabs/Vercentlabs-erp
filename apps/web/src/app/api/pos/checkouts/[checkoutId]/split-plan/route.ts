import { z } from "zod";

import { getPosSplitPaymentStatus, saveSplitPaymentPlan } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// The split plan and the authoritative state of each part: payable, confirmed, remaining and unallocated amounts, and what to collect next.
export async function GET(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posRead(request, async (client, context) => ({ split: await getPosSplitPaymentStatus(client, context, checkoutId) }), "pos.view");
}

// Plan or change the split: one to three methods (cash, card, UPI — one of each). A part that has started keeps its amount; the total never
// exceeds the bill.
const schema = z.object({
  components: z.array(z.object({ method: z.enum(["cash", "card", "upi"]), amount: z.union([z.string().trim().max(20), z.number()]) })).min(1).max(3),
  expectedPlanVersion: z.number().int().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

const save = (request: Request, { params }: Params) => params.then(({ checkoutId }) => posMutation(request, schema, async (client, context, input) => ({
  split: await saveSplitPaymentPlan(client, context, checkoutId, { ...input, components: input.components.map((component) => ({ ...component, amount: String(component.amount) })) }),
}), 200, "pos.sale.create"));

export const POST = save;
export const PUT = save;

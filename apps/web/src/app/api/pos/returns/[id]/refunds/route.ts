import { z } from "zod";

import { initiatePosReturnRefund, listPosRefunds } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the return's refunds.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => listPosRefunds(client, context, { sourceType: "pos_return", sourceId: id }), "pos.view");
}

// POST: refund the posted return (the rest of what it owes, or an amount). Within your refund limit it is authorized and — unless
// execute is false — paid now: cash when you confirm handing it over, card / UPI through the original provider. Above it, it waits for a
// supervisor.
const schema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  reasonNote: z.string().trim().max(300).optional(),
  execute: z.boolean().optional(),
  cashRefundConfirmed: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await initiatePosReturnRefund(client, context, id, input) }), 201, "pos.view");
}

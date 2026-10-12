import { z } from "zod";

import { executePosRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// POST: pay the authorized refund: cash when cashPayoutConfirmed (handed over now, from your open session), card / UPI through the original
// provider. Each component once, whatever the retries.
const schema = z.object({ cashPayoutConfirmed: z.boolean().optional(), expectedVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(8).max(200).optional() });

export async function POST(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ refund: await executePosRefund(client, context, refundId, input) }), 200, "pos.view");
}

import { z } from "zod";

import { refundUnfinalizedCardPayment } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ attemptId: string }> };

// Give back a captured card whose sale could not be finalised: the whole payment is refunded through the provider, against the original
// transaction, and tracked until the provider confirms it.
const schema = z.object({ reason: z.string().trim().max(200).optional(), approvalId: z.string().uuid().optional(), idempotencyKey: z.string().min(8).max(100) });

export async function POST(request: Request, { params }: Params) {
  const { attemptId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ attempt: await refundUnfinalizedCardPayment(client, context, attemptId, input) }), 200, "pos.sale.create");
}

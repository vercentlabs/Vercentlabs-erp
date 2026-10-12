import { z } from "zod";

import { cancelPosCardAttempt } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ attemptId: string }> };

// Ask the provider to cancel an attempt that was not captured (PAYMENT_VOID_PENDING). Cancelling is a request: until the provider confirms,
// the attempt is CANCEL_PENDING and the bill stays locked. A captured card is refunded, never cancelled.
export async function POST(request: Request, { params }: Params) {
  const { attemptId } = await params;
  return posMutation(request, z.object({ reason: z.string().trim().max(200).optional() }), async (client, context, input) => ({
    attempt: await cancelPosCardAttempt(client, context, attemptId, input),
  }), 200, "pos.sale.create");
}

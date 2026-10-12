import { z } from "zod";

import { cancelPosCardAttempt } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ attemptId: string }> };

// Cancel an open UPI request through the provider (PAYMENT_VOID_PENDING) — needed before a replacement QR. Until the provider confirms, the
// request is CANCEL_PENDING; money that still arrives is kept as a payment exception, never moved to another bill.
export async function POST(request: Request, { params }: Params) {
  const { attemptId } = await params;
  return posMutation(request, z.object({ reason: z.string().trim().max(200).optional() }), async (client, context, input) => ({
    attempt: await cancelPosCardAttempt(client, context, attemptId, input),
  }), 200, "pos.sale.create");
}

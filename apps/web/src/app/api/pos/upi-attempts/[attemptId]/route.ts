import { getPosCardAttempt } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ attemptId: string }> };

// The authoritative state of a UPI / digital payment request (the same shared payment lifecycle as cards): an open one is asked of the
// provider again, an expired QR shows EXPIRED (not failed), a confirmed payment finalises the sale. Polled by the checkout screen.
export async function GET(request: Request, { params }: Params) {
  const { attemptId } = await params;
  return posRead(request, async (client, context) => ({ attempt: await getPosCardAttempt(client, context, attemptId) }), "pos.view");
}

import { getPosCardAttempt } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ attemptId: string }> };

// The authoritative state of a card attempt: a live one is asked of the provider again (never assumed); a captured one finalises the sale
// when everything else on the bill is confirmed. Polled by the checkout screen while it waits.
export async function GET(request: Request, { params }: Params) {
  const { attemptId } = await params;
  return posRead(request, async (client, context) => ({ attempt: await getPosCardAttempt(client, context, attemptId) }), "pos.view");
}

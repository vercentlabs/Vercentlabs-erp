import { listPosSessionCashPayments } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// A cash session's cash for reconciliation: every cash tender and movement, received, change, net, handed back, refunds, cash still pending
// and (for those allowed to see it) the expected cash.
export async function GET(request: Request, { params }: Params) {
  const { sessionId } = await params;
  return posRead(request, async (client, context) => ({ session: await listPosSessionCashPayments(client, context, sessionId) }), "pos.view");
}

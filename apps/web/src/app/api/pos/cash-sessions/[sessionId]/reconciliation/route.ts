import { getCashSessionReconciliation } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// GET: the cash session's closing reconciliation — COUNT_PENDING until counted (the blind count), then the difference, its status, the cash
// ledger and policy versions; expected cash only for those who may see it.
export async function GET(request: Request, { params }: Params) {
  const { sessionId } = await params;
  return posRead(request, async (client, context) => ({ reconciliation: await getCashSessionReconciliation(client, context, sessionId) }), "pos.view");
}

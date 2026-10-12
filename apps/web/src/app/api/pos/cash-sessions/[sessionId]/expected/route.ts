import { getCashSessionExpectedBalance } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// GET: what the drawer should hold now — the float plus each kind of physical cash event, once (SESSION_VIEW_EXPECTED_CASH).
export async function GET(request: Request, { params }: Params) {
  const { sessionId: id } = await params;
  return posRead(request, async (client, context) => ({ expected: await getCashSessionExpectedBalance(client, context, id) }), "pos.view");
}

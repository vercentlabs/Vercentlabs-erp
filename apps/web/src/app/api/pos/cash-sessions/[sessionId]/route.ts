import { getPosCashSession } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// GET: a cash session — its confirmed opening count, corrections beside it, and (for those who may see it) the expected cash now.
export async function GET(request: Request, { params }: Params) {
  const { sessionId: id } = await params;
  return posRead(request, async (client, context) => ({ cashSession: await getPosCashSession(client, context, id) }), "pos.view");
}

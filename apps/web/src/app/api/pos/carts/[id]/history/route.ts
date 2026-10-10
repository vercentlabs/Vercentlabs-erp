import { getPosCartHistory } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Every material change to the bill: what, who, on which terminal, and the version it produced.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ events: await getPosCartHistory(client, context, id) }), "pos.view");
}

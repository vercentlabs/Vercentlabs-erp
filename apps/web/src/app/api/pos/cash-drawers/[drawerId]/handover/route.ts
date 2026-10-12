import { getCashDrawerHandover } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ drawerId: string }> };

// GET: the cash handed over in this drawer and not yet received (amounts only for those who may see expected cash), or null.
export async function GET(request: Request, { params }: Params) {
  const { drawerId } = await params;
  return posRead(request, async (client, context) => ({ handover: await getCashDrawerHandover(client, context, drawerId) }), "pos.view");
}
